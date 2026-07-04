# Correctness review — equality & comparison semantics
Area: `.isSame()` / `.is()` / `.isEqual()`, `eq()`/`cmp()` in `src/compute-engine/boxed-expression/compare.ts`, relational predicates, `order()` canonical sort.
Branch main @ 9b818ec8. All findings have executed repros (scripts in `scratchpad/compare/b1…b7`). Cross-referenced against SYMBOLIC_FINDINGS.md (P1-9, P0-8, P1-1 excluded / only extensions reported).

---

## P0 findings

### C1 (P0). `assume(x = y)` between two free symbols is silently dropped — value binding wiped by the type setter, nothing reaches the assumptions DB
**Repro** (b3c/b3d/b3g):
```ts
const ce = new ComputeEngine();
ce.assume(ce.parse('a = b'));        // → 'ok'
ce.symbol('a').value                 // undefined  (binding lost)
ce.ask(ce.expr(['Equal','a','b']))   // []         (nothing in DB)
ce.symbol('a').isEqual(ce.symbol('b')) // false    (wrong definitive)
```
Same for `u=v`, `q=r`, `x=y`. **But `assume(m=n)` works** (`m.value = n`, `m.isEqual(n)=true`) — by scope accident.
**Why**: `assumeEquality` case 2 (`src/compute-engine/assume.ts:250-281`). When the lhs symbol is bound in the *current* scope (which is where `ce.parse` auto-declares new symbols), it takes the `_setSymbolValue` path:
```ts
ce._setSymbolValue(lhs, val);                                     // assume.ts:277 — sets value
if (def.value.inferredType) def.value.type = inferTypeFromValue(ce, val); // :278 — WIPES it
```
The `set type` setter (`src/compute-engine/boxed-expression/boxed-value-definition.ts:222-236`) resets `_value = undefined` whenever the new type `isUnknown` — and `inferTypeFromValue` of a free-symbol value *is* `unknown`. Direct experiment (b3g): after `_setSymbolValue('a', b)`, `a.value = b`; after `def.value.type = <unknown>`, `a.value = undefined`. This contradicts the class's own docstring (`boxed-value-definition.ts:35-36`: "When the type is changed, the value is preserved if it is compatible"). `m=n` works only because `m` happens to be declared in a *parent* scope (`bindings.has('m')` false → the `ce.declare` path at :275 is taken instead).
Case 3 (`assume.ts:310-311`) has the identical wipe pattern.
Because case 2 `return 'ok'` precedes case 4, the fact is also never stored in `ce.context.assumptions` — no consumer (ask/verify/eq) can ever see it.
**Fix direction**: in `set type`, do not clear the value when the new type is `unknown` (honor the documented compatibility rule), and/or in `assumeEquality` set the type *before* the value or skip `inferTypeFromValue` when it yields `unknown`.
**Test**: fresh engine → `assume('a=b')` → expect `a.value` defined and `a.isEqual(b) === true`; repeat for a symbol pre-declared in a parent scope.

### C2 (P0). `eq()` returns definitive `false` for two distinct symbols *before* consulting the assumptions DB — `ask()` consult is unreachable for symbol pairs
**Repro** (b3h): with `Equal(a,b)` manually stored in the assumptions DB (`ask(Equal(a,b)).length === 1`):
```ts
ce.symbol('a').isEqual(ce.symbol('b'))  // false — assumption ignored
```
Also plain free symbols: `x.isEqual(y) === false` (must be `undefined`: x,y unconstrained; note `x.isEqual(2)` correctly returns `undefined`, so the intended semantics is value-equality with unknown → undefined).
**Why**: `compare.ts:159` `if (isSymbol(a) && isSymbol(b)) return a.symbol === b.symbol;` executes before the `ce.ask(...)` consult at `compare.ts:177`. So for symbol-symbol pairs the assumptions DB is dead code in `eq()`.
Beyond P0-8: P0-8 is the `verify()` path; this is the public `isEqual()` API, and the repro shows the DB-consult ordering bug directly, independent of verify's heuristics.
**Fix direction**: at :159 return `true` for identical names, otherwise fall through to the ask() consult and finally `undefined`.
**Test**: `x.isEqual(y)` → `undefined`; after storing `Equal(a,b)` (once C1 fixed, via `assume`) → `true`; after `assume(p≠q)` → `false`.

### C3 (P0). Real-vs-complex ordering predicates return definitive answers by comparing real parts — for every non-machine numeric representation
**Repro** (b4): all should be `undefined` (ℂ is unordered):
```ts
ce.number(1.5).isLess(ce.expr(['Complex',2,3]))            // true  (1.5 boxes to BigNumericValue!)
ce.expr(['Rational',1,3]).isLess(ce.expr(['Complex',2,3])) // true
ce.expr(['Sqrt',2]).evaluate().isLess(...2+3i)             // true
ce.parse('0.5').isLess(...2+3i)                            // true
// control: machine-int lhs is correctly guarded:
ce.number(2).isLess(...1+i)                                // undefined
```
**Why**: `cmp()` number-number path (`compare.ts:298-313`) calls `av.lt(bv)`. All three `NumericValue` implementations guard `this.im !== 0` but never check `other.im`:
- `machine-numeric-value.ts:572-594` (`lt/lte/gt/gte`: `return this.decimal < other.re`)
- `big-numeric-value.ts:662-679` (`this.decimal.lt(other.bignumRe ?? other.re)`)
- `exact-numeric-value.ts:797-819` (`this.re < other.re`)
The machine-int lhs escapes only because that branch calls `bv.lt(av)` with the *complex* value as `this`. Since every non-integer float literal defaults to `BigNumericValue` (verified in b7), this hits the common path.
**Fix direction**: in each `lt/lte/gt/gte`, `if (typeof other !== 'number' && other.im !== 0) return undefined;`.
**Test**: matrix of {machine int, big float, rational, radical} × {complex} for all four predicates → all `undefined`.

### C4 (P0). `cmp()`'s `.re` fallbacks ignore imaginary parts — symbols and literals with complex values are ordered against reals
**Repro** (b4), all should be `undefined`:
```ts
ce.symbol('ImaginaryUnit').isLess(2)        // true   (i < 2 !)
ce.symbol('ImaginaryUnit').isGreater(2)     // false
ce.assign('z', ce.expr(['Complex',1,1]));
ce.symbol('z').isLess(2)                    // true
ce.symbol('z').isGreater(0)                 // true
ce.number(2).isGreater(ce.symbol('z'))      // true
ce.number(2).isLess(ce.symbol('z'))         // false
// complex literal vs bounded symbol:
ce2.assume(ce2.parse('w > 4'));
ce2.expr(['Complex',1,1]).isLess(ce2.symbol('w'))  // true
```
**Why**: four `.re`-based fallbacks in `cmp()` never check `im`:
- `compare.ts:363-368` (symbol lhs vs number rhs: `const aNum = a.re`) — hits ImaginaryUnit (re=0) and z=1+i (re=1)
- `compare.ts:492-500` (symbol lhs, generic rhs)
- `compare.ts:287-292` (number lhs vs symbol rhs: `const bSymNum = b.re`)
- `compare.ts:239-258` (complex-number lhs vs bounded-symbol rhs: `aNum = a.numericValue.re` — im discarded)
**Fix direction**: each fallback should require `a.im === 0` / `b.im === 0` before ordering.
**Test**: `i.isLess(2)`, `z(=1+i).isLess(2)`, `2..isGreater(z)`, `(1+i).isLess(w>4)` → all `undefined`.

### C5 (P0). `order()`/`addOrder()`/`equalOrder()` return `NaN` for NaN operands — canonical sort is non-deterministic and input-order dependent
**Repro** (b5/b5b):
```ts
order(ce.number(NaN), ce.number(0.5))  // NaN  (12 NaN pairs in a 39-expr pool; addOrder same)
// end-to-end: same math input, different arg order → DIFFERENT canonical forms:
ce.expr(['Add', NaN, 0.5, 'x', 3.7]).json  // ["Add","x","NaN",0.5,3.7]
ce.expr(['Add', 3.7, 'x', 0.5, NaN]).json  // ["Add","x",0.5,3.7,"NaN"]
// → .isSame() between them: false.  Multiply: same.  Equal(NaN,0.5) vs Equal(0.5,NaN): isSame false.
// shuffle+sort of the same pool yields different sequences (sort not deterministic).
```
**Why**: rank `'real'` includes NaN (`Number.isInteger(NaN)` false, `order.ts:147`), then the comparator returns `af - bf` = NaN (`order.ts:251-263`). `equalOrder` has the same `af - bf` at `order.ts:105-111`. `Array.sort` behavior with a NaN comparator is unspecified → canonical form of any commutative expression containing NaN depends on input order. This breaks the canonical-form contract (two boxings of the same expression are not `isSame`), which corrupts dedup/matching/simplify-loop cycle detection for NaN-containing expressions.
Non-NaN battery is clean: 0 antisymmetry, 0 transitivity (incl. equivalence-class), 0 reflexivity failures over 39² pairs / 39³ triples.
**Fix direction**: give NaN a fixed sort position (e.g. compare via `(Number.isNaN(af) ? +∞ : af)`) and return 0 for NaN-NaN; same in `equalOrder`.
**Test**: canonical json of `['Add',NaN,0.5,'x',3.7]` equals that of every permutation; `order(a,b)` never NaN over the pool.

### C6 (P0). Documented `.is()` symmetry broken for symbols bound to expression values
CLAUDE.md: "`.is(v)` — Symmetric: `a.is(b)` always equals `b.is(a)`."
**Repro** (b6):
```ts
ce.assign('g', ce.parse('x^2+1'));
ce.symbol('g').is(ce.parse('x^2+1'))   // true
ce.parse('x^2+1').is(ce.symbol('g'))   // false  ← asymmetric
```
**Why**: `BoxedSymbol.is` (`boxed-symbol.ts:164-177`) delegates to the bound value. The abstract `is()` (`abstract-boxed-expression.ts:559-617`) never follows the *other* side's binding: `isSame` fails (see C7/C8), expansion fails, then `this.freeVariables.length > 0 → return false` (:584). The 33-representation symmetry matrix (b1) shows `.is` symmetric for *number*-valued bindings only because the numeric fallback rescues those; expression-valued bindings break the documented contract.
**Fix direction**: in abstract `is()`, if `other` is a symbol with a bound value, recurse on `other.value` (mirror of BoxedSymbol.is).
**Test**: `f := x²+1`; assert `a.is(b) === b.is(a)` for (f, x²+1) and for value-bound symbol pairs.

---

## P1 findings

### C7 (P1). `BoxedSymbol.isSame` fails to follow the binding when `other` is a function expression
**Repro** (b6/b7): `ce.assign('g', ce.parse('x^2+1')); ce.symbol('g').isSame(ce.parse('x^2+1'))` → **false**, even though `g.value` is exactly `x^2+1` and the contract says isSame "follows symbol value bindings".
**Why**: `boxed-symbol.ts:188-196` unwraps `rhs = other.value` — for a `BoxedFunction`, `.value` is `undefined` (`boxed-function.ts:225-227`) → falls to `return false`. Number/string literals work because their `.value` is themselves.
**Fix direction**: compare `this.value?.isSame(other)` (don't unwrap `other.value`, or fall back to `other` when `.value` is undefined).
**Test**: `g.isSame(ce.parse('x^2+1')) === true`.

### C8 (P1). `isSame` symmetry breaks beyond P1-9's exact float-vs-rational shape (documented per prompt: symbol-with-value pairs, exact-vs-bignum, transitivity)
**Repro** (b1/b3/b6) — `a.isSame(b) ≠ b.isSame(a)` for:
- `one:=1`: `one.isSame(ce.number(1))`=true / `ce.number(1).isSame(one)`=false. Same for `third:=1/3`, `zc:=1+i`.
- `ImaginaryUnit.isSame(Complex(0,1))`=true / `Complex(0,1).isSame(ImaginaryUnit)`=false (constant binding).
- exact vs bignum at default precision 21: `Rational(1,3).isSame(0.333…333 @30 digits)`=true / reverse=false. Mechanism differs from P1-9: `ExactNumericValue.eq` downcasts both to machine float (`exact-numeric-value.ts:794` `other.re === this.re`), while `BigNumericValue.eq` compares `this.decimal.eq(other.bignumRe)` at *current engine precision* (`big-numeric-value.ts:657-659`) → precision-dependent asymmetry (both true at `ce.precision = 30`).
- **Transitivity broken**: `r=Rational(1,3)`, `m=0.3333333333333333`, `b=0.333…(30d)`: `r.isSame(m)`=true, `r.isSame(b)`=true, but `m.isSame(b)`=false — isSame is not an equivalence relation, which invalidates its use as a dedup/equality key (ExpressionMap, repeated-wildcard matching).
**Why**: `same()` (`compare.ts:42-52, 63-68`) never follows symbol bindings; only `BoxedSymbol.isSame` does (one-directional). Float-vs-exact leniency direction-dependent as above.
**Fix direction**: either make `same()` follow bindings on the rhs too (symmetric), or (preferable, aligning with P1-9's fix) make isSame strictly structural in *both* directions and let `.is`/`.isEqual` own value-following. Decide + document; add a symmetry property test.

### C9 (P1). `eq()` "no unknowns" branch collapses indeterminate finiteness to definitive `false` — non-canonical true equalities report `false`
**Repro** (b3b/b3c):
```ts
ce.expr(['Add',1,1], {canonical:false}).isEqual(2)   // false  (1+1 == 2 !)
ce.expr(['Sqrt',4], {canonical:false}).isEqual(2)    // false  (canonical → true)
ce.expr(['Hold',['Add',1,1]]).isEqual(ce.expr(['Hold',2]))  // false
// contrast: ce.expr(['Add','x','x'],{canonical:false}).isEqual(ce.parse('2x')) → true (unknowns path)
```
**Why**: `compare.ts:129-137`: with `unknowns.length===0`, if `a.isFinite && b.isFinite` is not true (here `isFinite` is not resolvable on unbound/inert expressions and `.N()` returns self), control falls through `isNaN`/`isInfinity` checks to a blanket `return false`. A wrong definitive answer on the public API for a mathematically true equality; must be `undefined` (or canonicalize first).
**Fix direction**: in `eq()`, canonicalize non-canonical inputs before comparing (or at minimum `return undefined` when finiteness is indeterminate instead of the final `return false`).
**Test**: the three repros → `true`, `true`, `undefined`/`true` respectively.

### C10 (P1). `cmp()` applies tolerance in some paths but not the NumericValue-vs-NumericValue path — `isLess` and `isEqual` are simultaneously `true`
**Repro** (b4), tolerance = 1e-10:
```ts
const a = ce.number(1), b = ce.number(1 + 1e-11);   // b is BigNumericValue
a.isEqual(b)   // true   (within tolerance — eq() path, compare.ts:167-171)
a.isLess(b)    // true   (exact compare — cmp() path)  ← contradictory pair
// contrast: Pi.isLess(3.1415926535897932) → false (symbol path DOES use tolerance, :366)
```
**Why**: `cmp()` machine-machine (`compare.ts:225`) and all symbol/function fallbacks (:290, :366, :384, :419, :425) use `engine.tolerance`, but the NumericValue-NumericValue branch (`compare.ts:298-313`) uses exact `eq`/`lt`. Consumers can derive `a = b ∧ a < b`.
**Fix direction**: use `isZeroWithTolerance` on the difference (or tolerance-aware eq) in :298-313, consistent with the rest of `cmp()`.
**Test**: for |a−b| ≤ tol: `isEqual`=true, `isLess`=false, `isLessEqual`=true across machine/big/exact representations.

### C11 (P1). Public `isEqual` returns definitive `false` for possibly-equal expressions with free variables — inconsistent with its own `undefined` discipline (isEqual-API consequence beyond P0-8)
**Repro** (b3/b6/b7), all deterministic over 10 fresh engines:
```ts
x.isEqual(2)                    // undefined  ← intended value-semantics ("depends on x")
x.isEqual(ce.parse('1-x'))      // false      (true at x = 1/2)
ce.parse('x+1').isEqual(5)      // false      (true at x = 4)
ce.parse('x^2').isEqual(x)      // false      (true at x ∈ {0,1})
ce.parse('|x|').isEqual(x)      // false      (true for x ≥ 0)
ce.expr(['List',1,2]).isEqual(x) // false     (x could be [1,2])
```
**Why**: the function-expression branch of `eq()` ends in `stochasticEqual` (`compare.ts:145`) which produces definitive `false`, while the symbol-vs-number branch ends in `undefined` (:181). Two different three-valued semantics inside one API. Additionally, both the function branch (returns at :145) and symbol-symbol (:159, see C2) exit before the assumptions consult (:177), so `ask()` can never rescue any of these.
**Fix direction**: pick one semantics. If isEqual is value-equality (as `x.isEqual(2)` implies), sampling may only ever prove *inequality* when the expressions are provably not identical AND the caller wants identity semantics — i.e. return `undefined` (not false) from the sampling fallback when the difference has free variables. Cross-ref P0-8 for the verify() twin.
**Test**: each repro above → `undefined`; `(x+1).isEqual(x+2)` → may stay `false` only under explicitly documented identity semantics — then `x.isEqual(2)` must be `false` too (consistency either way).

---

## P2 findings

### C12 (P2). `eq()` never consults inequality bounds — `isEqual` misses refutations `cmp()` can make
**Repro** (b3): `assume(w>4)`: `w.isEqual(2)` → `undefined`, while `w.isLess(3)` → `false` proves w≠2. `compare.ts` eq() symbol path consults `valueDefinition.eq`, `ask(Equal)`, `ask(NotEqual)` but not `getInequalityBoundsFromAssumptions`. Fix: consult bounds (or call `cmp()`) in eq()'s symbol-number path; return `false` when bounds exclude the value.

### C13 (P2). `cmp()` bounds logic only handles symbol-vs-number — provable symbol-vs-symbol orderings return `undefined`
**Repro** (b7): `assume(s>4); assume(t<1)`: `s.isGreater(t)` → `undefined` (provably true). `compare.ts:432-503` checks bounds only when the other side is a number. Missed inference, not wrong answer.

### C14 (P2). Primitive vs boxed argument disagreement in `isSame`
**Repro** (b2/b2b): `Rational(1,2).isSame(0.5)` = false but `Rational(1,2).isSame(ce.number(0.5))` = **true**; `Sqrt(2).isSame(Math.SQRT2)` = false but boxed = **true**. Same value, different answer depending on argument form (contract says primitives are accepted). **Why**: primitive path hits `ExactNumericValue.eq(number)` which requires an integer (`exact-numeric-value.ts:781-786`); boxed path hits `eq(NumericValue)`'s machine-float downcast (`:794`). Note `ce.number(0.5)` boxes to `BigNumericValue`, so "boxed 0.5" is the float-collision path of C8/P1-9. Fix: make primitive and boxed agree — falls out of the P1-9/C8 decision.

### C15 (P2). `.isSame(-0)` is `false` against zero
**Repro** (b2): `ce.number(0).isSame(-0)` → false; `ce.number(-0).isSame(-0)` → false (!; −0 is normalized to +0 at boxing, then `Object.is(0,-0)` fails at `boxed-number.ts:665`); yet `ce.number(-0).isSame(ce.number(0))` → true. Fix: use `===` with an explicit `Number.isNaN` special case instead of `Object.is`, or normalize −0 in the primitive path.

### C16 (P2). List/tensor `isEqual` ignores tolerance — inconsistent with scalar `isEqual`
**Repro** (b6): `[1,2].isEqual([1, 2+1e-13])` → false, while `ce.number(2).isEqual(2+1e-13)` → true. Elementwise comparison (List `eq` handler / `tensor.equals`) is exact. Either document (collections compare exactly) or apply tolerance elementwise.

### C17 (P2/P3). NaN cross-method matrix is surprising and undocumented
**Repro** (b2): `nan.isSame(NaN)`=true (Object.is; all boxed NaN interned to one object), `nan.is(NaN)`=true (deliberate, `abstract-boxed-expression.ts:595`), `nan.isEqual(NaN)`=false (IEEE, `compare.ts:169`). So `is` and `isEqual` disagree on NaN. Ordering predicates correctly `undefined`. Document the intended matrix; it's the only pair where `is`=true ∧ `isEqual`=false (rubric flags is/isEqual disagreement cells).

---

## P3 findings

### C18 (P3). `order()` complex ordering contradicts its own doc comment
Doc (`order.ts:212-214`): "ordered by their real parts; tie → |im|; tie → im". Code (`order.ts:241-248`): sorts by `im` FIRST, then `re`. Executed: `order(1+5i, 2+3i)` = +2 (2+3i sorts first despite re 2 > 1). Affects canonical operand order of complex-containing sums/products (deterministic, so P3 doc-or-code fix).

### C19 (P3). Descending/reverse-alphabetical orderings in `order()` vs ascending in `cmp()`
`order()` 'fn' rank sorts operators reverse-alphabetically (`order.ts:359-360`) and 'string' rank descending (`:365-372`), while `cmp()` orders strings ascending (`compare.ts:508-511`; `'a'.isLess('b')`=true). Antisymmetric and internally consistent (verified in b5) — but the divergence between canonical sort and user-facing ordering is undocumented.

---

## Verified clean (no finding)
- `.is` symmetric across the full 33-representation matrix (except C6's expression-valued bindings); explicit-tolerance `.is` symmetric, forces numeric compare, `isSame`-first shortcut is sound.
- `order()` non-NaN battery: 0 antisymmetry / 0 transitivity (incl. equivalence-class transitivity) / 0 reflexivity failures (39² pairs, 39³ triples).
- Infinity semantics coherent: `∞.isEqual(∞)` true, `∞.isLess(∞)` false, `∞.isGreaterEqual(∞)` true, `±∞` ordered, `∞.isEqual(−∞)` false, ComplexInfinity vs +∞ false/undefined (matches comparisons.test.ts G14).
- NaN ordering predicates all `undefined` (cmp guards NaN before NumericValue.lt's `NaN < x → false` quirk).
- Unreduced exact rationals/radicals normalized at construction (2/4 ≡ 1/2, 2√2 ≡ √8) — the `rational[0]==` field compare in `ExactNumericValue.eq` is safe.
- `Equal(x,2).isEqual(Equal(2,x))` true (canonical arg sort), `Less(x,y).isEqual(Greater(y,x))` true, `Set(1,2)=Set(2,1)` true, `Tuple≠List` false, `Interval` compare correct.
- bigint primitives: `.isSame(3n)`, huge bigints, 2^53 — correct; booleans/strings per contract; `2<3` isSame(true) false but `.evaluate().isSame(true)` true (isSame doesn't evaluate — consistent with "fast structural").
- Symbol binding lifecycle: assign/reassign/forget and scoped `assume(v=2)` + popScope all correctly reflected in isSame/isEqual.
- Inequality-assumption predicates (A3 semantics) correct: `w>4` ⇒ `isGreater(4)`=true, `isGreater(5)`=undefined, `isLessEqual(4)`=false; number-vs-bounded-symbol both directions.
- `x/x→1`, `(x+1)²≡x²+2x+1` (expand path), `sin²+cos²≡1` all true; `x.isLess(x+1)` true via difference.
- Stochastic isEqual deterministic across 10 fresh engines (no flip-flop) — the C11 issue is wrong-definitive, not nondeterminism.

## Tests locking wrong expectations
None found for the behaviors above: `test/compute-engine/equal.test.ts`, `comparisons.test.ts` (A1/A3/G14 lock *correct* semantics), `structural-comparison.test.ts`, `assumptions.test.ts` (no symbol=symbol assume coverage — C1 is untested territory). `equal.test.ts:36` `['0 = 0', 'x = 0'] → false` encodes identity semantics for equations; fine as-is but should be revisited when C11's semantics decision is made.

## Repro scripts
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/compare/`
- `b1-symmetry.ts` — 33-representation × 3-method symmetry matrix
- `b2-reflexivity.ts`, `b2b-probe.ts` — NaN/−0/primitive-vs-boxed/transitivity
- `b3-threevalued.ts`, `b3b-tail.ts`, `b3c-isolate.ts`, `b3d-assume-probe.ts`, `b3e-case2.ts`, `b3f-setvalue.ts`, `b3g-typewipe.ts`, `b3h-askorder.ts` — isEqual discipline, assume(a=b) root cause, ask-order
- `b4-complex-order.ts` — complex/infinity/tolerance ordering
- `b5-order.ts`, `b5b-nan-canonical.ts` — order() totality + NaN canonical instability
- `b6-misc.ts` — stochastic determinism, strings, precision asymmetry, .is tolerance, symbol-with-function-value
- `b7-final.ts` — function-path three-valued, bounded-symbol pairs, scope lifecycle
