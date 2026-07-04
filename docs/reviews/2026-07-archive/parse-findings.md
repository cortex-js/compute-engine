# Parse & Serialize Semantics — Correctness Findings

Reviewer area: LaTeX syntax layer (`src/compute-engine/latex-syntax/`), lenient parsing,
Desmos-compat. Branch main @ 9b818ec8. All findings below were **empirically reproduced**
with `npx tsx` scripts under `scratchpad/parse/` (batteries b1–b8) unless marked
"static analysis only". None are duplicates of SYMBOLIC_FINDINGS.md items.

Baseline: `npm run test compute-engine/latex-syntax-standalone` → 29/29 pass.

---

## P0-A — Mixed-direction relational chains silently misparse (wrong truth values)

**Repro** (all `valid:true`, no error signal):

```
ce.parse('1 \\le 2 > 0')  → ["And",["LessEqual",1,0],["Less",0,2]]   .evaluate() → False  (should be True)
ce.parse('3 \\ge 2 < 4')  → ["And",["LessEqual",4,3],["Less",2,4]]   .evaluate() → False  (should be True)
ce.parse('a > b < c')     → ["Less","b","c","a"]                      (asserts b<c<a; user wrote a>b ∧ b<c)
ce.parse('x \\le y > z')  → ["And",["LessEqual","x","z"],["Less","z","y"]]  (x≤z, z<y — user wrote x≤y ∧ y>z)
ce.parse('1 = 2 > 0')     → ["And",["Less",0,2],["Equal",1,0]]        (fabricates 1=0)
ce.parse('5 > 4 < 2')     → ["Less",4,2,5]                            (asserts 4<2<5)
```

Concrete wrong values: `1 ≤ 2 > 0` is True, CE returns **False**. `3 ≥ 2 < 4` is True, CE
returns **False**. For `a > b < c` with a=3,b=1,c=5 the user's statement is True but CE's
`Less(b,c,a)` = 1<5<3 is False.

**Why wrong**: a chain with a direction flip parses raw as a *nested* relation
(`LessEqual(1, Greater(2,0))`). Canonicalization normalizes `Greater→Less` bottom-up,
**reversing the nested chain's operand order**, and then `canonicalRelational`
(`src/compute-engine/library/relational-operator.ts:623-651`) picks the boundary term by
position (`i === 0 ? last : first`) — which is the wrong endpoint after the flip. When the
outer relation is itself flipped to the same operator as the inner one, `flatten(ops, operator)`
(line 630) merges the nested chain as if associativity held, producing `Less(b,c,a)` from
`a > b < c`.

Same-direction chains are correct (`1<2<3` → `Less(1,2,3)`; `5 \le b \lt 7` →
`And(5≤b, b<7)` — this exact class was previously fixed once, see comment at
relational-operator.ts:634-640, but only for same-direction mixes).

**Existing tests are one-sided**: `test/compute-engine/relational-operators.test.ts:289-324`
("Mixed chained inequalities") covers only `≤`+`<` (same direction). No test covers a
direction flip.

**Fix direction**: unfold chains where the direction is still known — either in the parser
(relational infix parse handlers can detect `lhs`/`rhs` being relational and emit the `And`
with the shared middle term directly), or record the flip during canonicalization and select
the boundary operand accordingly. `flatten` must never merge across a flipped nested chain.

**Suggested tests**: `1 \le 2 > 0` ⇒ True; `3 \ge 2 < 4` ⇒ True;
`a > b < c` ⇒ `And(Less(b,a), Less(b,c))`; `1 = 2 > 0` ⇒ `And(Equal(1,2), Greater(2,0))` ⇒ False.

---

## P0-B — `--` parses as C-style Decrement; serializer itself emits `--` (round-trip meaning change)

**Repro (parser)** (all `valid:true`):

```
ce.parse('x--y')  → ["Multiply","y",["Decrement","x"]]
ce.parse('--x')   → ["PreDecrement","x"]
ce.parse('x---y') → ["Add",["Negate","y"],["Decrement","x"]]
ce.parse('x++y')  → ["Multiply","y",["Increment","x"]]
```

(`2--3` → 5 and `x - -y` → `Add(x,y)` are fine — the trap is symbol-adjacent `--`.)

**Repro (serializer→parser, the P0)**:

```
ce.box(['Subtract','x',['Negate','y']], {canonical:false}).latex  === 'x--y'
   → reparses as ["Multiply","y",["Decrement","x"]]      (was x−(−y) = x+y)
ce.box(['Negate',['Negate','x']], {canonical:false}).latex        === '--x'
   → reparses as ["PreDecrement","x"]                    (was x)
```

**Why wrong**: `Increment/Decrement/PreIncrement/PreDecrement` dictionary entries
(`src/compute-engine/latex-syntax/dictionary/definitions-other.ts:118-158`) hijack `- -`
adjacency at precedence 880. On the serializer side, the raw `Subtract` entry
(`definitions-arithmetic.ts:1767`) has no serialize handler, so default infix serialization
concatenates `x`, `-`, `-y` without parens/space; same for raw `Negate` nesting. (The
canonical-path serializer at definitions-arithmetic.ts:161-168 does handle the leading-`-`
case, but raw/structural expressions don't go through it.)

**Test asserting this behavior**: `test/compute-engine/latex-syntax/operators.test.ts:204-205`
(`'--x' // Predecrement` → `["PreDecrement","x"]`) — locks the parse side in as intended
behavior. In a CAS context, double negation is a far more likely reading than C pre-decrement.

**Fix direction**: (1) serializer: emit `x-(-y)` / `-(-x)` (wrap a leading-minus operand) in
default infix/prefix serialization; (2) reconsider or gate the `++`/`--` dictionary entries
(they are indistinguishable from arithmetic in math input).

**Suggested tests**: round-trip `Subtract(x, Negate(y))` and `Negate(Negate(x))` in raw form;
`ce.parse('x--y')` ⇒ `x+y` (or at minimum not `Decrement`).

---

## P0-C — `\log_2^2 x` silently parses as `x·(log 2)²`

**Repro**:

```
ce.parse('\\log_2^2 x') → ["Multiply","x",["Power",["Log",2],2]]    valid:true
```

Expected: `(log₂ x)²`, i.e. `["Power",["Log","x",2],2]` (the same convention that makes
`\sin^2 x` = `Power(Sin(x),2)` work). Actual meaning is completely different and there is
**no error signal**.

**Why wrong**: `parseLog` (`src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts:2148-2163`)
consumes `_base` but not a `^` superscript. On `\log_2^2 x` it sees `^` next, so
`parseArguments('implicit')` returns null → returns `['Log', 2]` (base misread as argument!),
then the generic supsub parser squares it and `x` is juxtaposed-multiplied.

**Fix direction**: mirror `parseTrig` (`definitions-trigonometry.ts:90-92,124`): after the
optional subscript, check for `^`, parse the arguments, and apply `Power(...)` last (with
`^{-1}` → inverse where appropriate).

**Suggested test**: `\log_2^2 x` ⇒ `["Power",["Log","x",2],2]`; `\log_2^2 8` evaluates to 9.

---

## P1-D — `\ln^2 x` / `\log^2 x` / `\ln^{-1} x` / `\exp^2 x` / `\lg^2 x` mangle to Tuple-with-Error

**Repro**:

```
ce.parse('\\ln^2 x')     → ["Tuple",["Power",["Ln",["Error","'missing'"]],2],"x"]   valid:false
ce.parse('\\ln^2(x)')    → same
ce.parse('\\log^2 x')    → ["Tuple",["Power",["Log",["Error","'missing'"]],2],"x"]
ce.parse('\\ln^{-1} x')  → ["Tuple",["Power",["Ln",["Error","'missing'"]],-1],"x"]
ce.parse('\\exp^2 x')    → ["Tuple",["Power",[error incompatible-type],2],"x"]
```

while `\cos^2 x`, `\sec^2 x`, `\sinh^2 x`, `\tan^{-1} x` all work via `parseTrig`.

Not fully silent (`isValid === false`), hence P1 not P0 — but this is bog-standard notation
(`\ln^2 x` appears throughout textbooks) and the produced structure bears no relation to the
intended one. Same root cause and fix as P0-C (parseLog/Exp/Lg lack the sup handling
parseTrig has). Note the serializer emits `\ln(x)^2` for `Power(Ln(x),2)`, which does
round-trip correctly — only the `\ln^2 x` input form is broken.

---

## P1-E — Chained `\ne` flattens to n-ary NotEqual whose semantics match no reading of the chain

**Repro**:

```
ce.parse('1 \\ne 2 \\ne 2') → ["NotEqual",1,2,2]   .evaluate() → True    (chain reading: (1≠2)∧(2≠2) = False;
                                                                          all-distinct reading: False)
ce.parse('1 \\ne 2 \\ne 1') → ["NotEqual",1,2,1]   .evaluate() → False   (chain reading: True)
```

**Why wrong**: two compounding problems. (1) The parser/canonicalizer flattens the `\ne`
chain into one n-ary `NotEqual` (via `canonicalRelational`/`flatten`), silently converting
chained-adjacent semantics into n-ary semantics. (2) The n-ary `NotEqual.evaluate`
(`src/compute-engine/library/relational-operator.ts:303-310`) never reassigns `lhs`, so it
implements "first element differs from all others" — not adjacent-pairs, not all-distinct.
`NotEqual(1,2,2)` → True is wrong under *every* interpretation. (The evaluate half overlaps
the symbolic-review area; the parse-time flattening decision is the syntax-layer half.)

**Fix direction**: parse `a \ne b \ne c` into `And(NotEqual(a,b), NotEqual(b,c))` (chained,
like mixed inequality chains), and fix the n-ary evaluate loop to update `lhs` (or define
n-ary NotEqual as all-distinct and evaluate all pairs).

**Suggested tests**: `1 \ne 2 \ne 2` ⇒ False; `1 \ne 2 \ne 1` ⇒ True (chained semantics).

---

## P1-F — Juxtaposition with a function-typed symbol silently becomes `Tuple`; parse meaning depends on prior unrelated parses

**Repro 1** (declared function):

```
ce.assign('f', ce.parse('x \\mapsto x^2'));
ce.parse('2f')  → ["Tuple",2,"f"]      valid:true
ce.parse('fx')  → ["Tuple","f","x"]    valid:true
ce.parse('f x') → ["Tuple","f","x"]    valid:true
```

Expected: multiplication (scaled function / f·x) or an error — a silent `Tuple` is a wrong
meaning with no signal. Same fallback already flagged for colors in
`docs/desmos-compat-notes.md` ("separate semantic question"); it bites for any
function-valued symbol.

**Repro 2** (state pollution — parse result changes after an unrelated parse):

```
const ce = new ComputeEngine();
ce.parse('depsilon')   → ["Multiply", i, e, "d","l","n","o","p","s"]
ce.parse('gcd(12,8)')  // STRICT mode misparse: c·g·["d",12,8] — auto-declares `d` as a function
ce.parse('depsilon')   → ["Tuple","d", e, "p","s", i, "l","o","n"]   // now a Tuple!
```

The same input silently changes meaning (Multiply → Tuple) because `d` acquired a function
type from a previous, unrelated misparse. Also note the sub-behavior: for an undeclared `f`,
`f(x)` → `Multiply(f,x)` but `f(1,2)` → `["f",1,2]` (arity decides application vs
multiplication — worth documenting).

**Files**: `src/compute-engine/boxed-expression/invisible-operator.ts:250-252` (Tuple
fallback in `canonicalInvisibleOperator`).

**Fix direction**: don't fall back to Tuple when an operand is function-typed and the others
are scalars — either treat as multiplication (Desmos-style `2f`) or produce an error node.

---

## P1-G — Lenient `x2 → x²` rule: strict-vs-lenient value divergence, self-inconsistent, contradicts LENIENT_PARSER.md

**Repro**:

```
ce.parse('x2')              → ["Multiply",2,"x"]       // strict: 2x
ce.parse('x2',{strict:false}) → ["Power","x",2]        // lenient: x²   ← same input, different VALUE, no signal
ce.parse('x1',{strict:false}) → "x"                    // the index 1 silently vanishes (x^1)
ce.parse('x12',{strict:false})→ ["Multiply",12,"x"]    // 12x — digit 1 excluded from the rule
ce.parse('x1+x2',{strict:false}) → ["Add",["Power","x",2],"x"]
```

Collateral damage inside lenient mode itself:

```
ce.parse('sqrt4',{strict:false})   → ["Multiply","q","r","s",["Power","t",4]]   // q·r·s·t⁴, valid:true
ce.parse('log2(8)',{strict:false}) → ["Multiply",8,"l","o",["Power","g",2]]     // 8·l·o·g², valid:true
```

**Why wrong**: `parse.ts:2193-2207` treats a single letter immediately followed by digit 2–9
as an implicit superscript ("copy-paste from web pages"). But flattened *subscripts* are at
least as common (`x1, x2` as indexed variables), and `docs/LENIENT_PARSER.md` (lines 144-150)
explicitly recommends the opposite mapping (`x1 → x_1`). The rule creates a silent
strict/lenient value divergence (2x vs x²) and swallows `1` entirely. It also fires mid-word,
poisoning would-be bare-function forms (`sqrt4`, `log2(...)`) with valid-looking nonsense
instead of an error.

**Fix direction**: pick one meaning and document it; if superscript is kept, at minimum
exclude contexts where the letter is part of a multi-letter run, include digit `1`
consistently, and reconcile the doc. (Personally: subscript matches the doc and Desmos.)

---

## P1-H — Lenient `sin x` (bare function without parens) silently = `i·n·s·x`

**Repro**:

```
ce.parse('sin x', {strict:false}) → ["Multiply",["Complex",0,1],"n","s","x"]   valid:true
ce.parse('sin(x)',{strict:false}) → ["Sin","x"]
```

`BARE_FUNCTION_MAP` (parse.ts:96, used at parse.ts:1968-2060) requires a following `(`. In
lenient mode — whose purpose is accepting ASCII math — `sin x` yields a product **including
the imaginary unit** (`i` → Complex(0,1)) with no error. Any numeric probe silently goes
complex. ASCIIMath/Typst both accept `sin x`.

**Fix direction**: in non-strict mode, accept bare function names followed by whitespace +
term (same implicit-argument logic as `\sin x`), or at least error rather than splitting
into letters when the letter-run exactly matches a known function name.

---

## P1-I — `[1,...,10]` leaks internal `ContinuationPlaceholder` as a list element

**Repro**:

```
ce.parse('[1,...,10]')   → ["List",1,"ContinuationPlaceholder",10]   valid:true
ce.parse('[1,...,10]').evaluate() → ["List",1,"ContinuationPlaceholder",10]
// while:
ce.parse('[1,2,...,10]') → ["Range",1,10,1]   ✓
ce.parse('[1...10]')     → ["Range",1,10]     ✓
```

A 3-element list containing an internal placeholder symbol, no error, survives evaluation.
Length/aggregation operations on it give wrong answers. Expected `Range(1,10)` (single-anchor
continuation, cf. Desmos `[1,...,10]`) or an error node.

**Files**: continuation handling in the list/sequence parse path (rg `ContinuationPlaceholder`
in `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` / collections canonicalization).
(Mechanism static-analysis only; the behavior repro above is executed.)

---

## P2-J — Set-builder with `\in` misparses: condition nests inside the domain

**Repro**:

```
ce.parse('\\{x \\in \\R : x > 0\\}') → ["Set",["Element","x",["Colon","RealNumbers",["Less",0,"x"]]]]  valid:true
// while these are fine:
ce.parse('\\{x : x>0\\}')      → ["Set","x",["Condition",["Greater","x",0]]]
ce.parse('\\{(x,y) : x>y\\}')  → ["Set",["Tuple","x","y"],["Condition",["Greater","x","y"]]]
ce.parse('\\{x | x > 0\\}')    → INVALID (pipe separator unsupported — errors, not silent)
```

The `∈`-form is the most common set-builder notation; the result wraps a `Colon` inside
`Element` — a structure no consumer interprets. Silent (valid:true).

---

## P2-K — `x^2^3` (invalid LaTeX) silently becomes a broadcasting List power

**Repro**:

```
ce.parse('x^2^3') → ["Power","x",["List",2,3]];  .N() → ["List",["Power","x",2],["Power","x",3]]
```

Real LaTeX rejects `x^2^3` ("double superscript"). CE's supsub collector
(parse.ts:2214/2297ff) gathers both superscripts into a `List` exponent, which then
broadcasts to a 2-element list of values. Recommend an error node (or right-associative
`x^(2^3)` if leniency is desired). No test covers this input.

---

## P2-L — `Sequence` serializes to space-joined LaTeX that reparses as a single number

**Repro**:

```
ce.box(['Sequence',1,2]).latex === '1 2';   ce.parse('1 2') → 12
```

The serializer (`definitions-core.ts:871-875`) uses a space separator *specifically* "otherwise
a sequence of numbers could be interpreted as a single number" — but whitespace **is** a digit
group separator (`1 234` → 1234), so exactly that misreading happens. Sequence(1,2) → 12 is a
value change on round-trip. Fix: serialize with `,` or wrap in `\left(...\right)`.

---

## P2-M — `Delimiter` with custom delimiters round-trips to a different collection type

**Repro**:

```
e = ce.box(['Delimiter',['Sequence',1,2],"'[,]'"], {canonical:false})
e.latex === '\\lbrack1,2\\rbrack'  → reparses as ["List",1,2]
// but canonical form of the same MathJSON is ["Tuple",1,2]
```

Tuple vs List are semantically different (fixed-arity vs collection). The custom-delimiter
styling changes the parsed type. Low frequency, but a silent type change.

---

## P2-N — `==` parses to inert `EqualEqual` (never evaluates)

**Repro**: `ce.parse('3==3').evaluate()` → `["EqualEqual",3,3]` (type `any`, not boolean;
neither True nor an error). Users from programming backgrounds (and LENIENT_PARSER.md's
own review note suggesting `==` → `=`) expect equality. Either map to `Equal` (at least in
lenient mode) or give `EqualEqual` boolean semantics.

---

## P2-O — Lenient mode: `!=` not implemented → `x!=2` silently means `x! = 2`

**Repro**: `ce.parse('3!=2', {strict:false})` → `["Equal",["Factorial",3],2]` (evaluates
False; the user's `3 != 2` is True). Correct under strict LaTeX tokenization, but
LENIENT_PARSER.md lists `!=` → `\neq` as a Phase-1 quick win, and lenient users will hit
this as a silent wrong value. Needs a lookahead disambiguation (`!=` not preceded by
space/factorial context) or doc warning.

---

## P2-P — Lenient unicode gaps (errors, not silent): `√ ≤ ∞ × · ½`

`ce.parse('√4', {strict:false})`, `'2≤3'`, `'∞'`, `'2×3'`, `'3·4'`, `'½'` all produce
`Error 'unexpected-token'` even in non-strict mode (while `π`, `θ`, `x²` work). Not a
misparse (fails loudly) — missing leniency for the most common unicode math characters.

---

## P3 — Notes / documentation-level

- **`0.999\ldots` drops the ellipsis** (→ `0.999`, valid). Intentional per
  `parse-number.ts:329-333` ("just ignore it"), but undocumented; `0.\overline{9}` is the
  supported repeating form. Document the truncation-marker behavior.
- **`\text{hello` (unclosed)** parses to `'hello'` with `valid:true` — silently accepts
  unterminated group.
- **`1,234.5` → `Tuple(1, 234.5)`** — comma is a sequence separator by design;
  `1\,234.5` → 1234.5 works. Worth a docs callout for Desmos/US-locale importers.
  `1{,}234.5` (common LaTeX thousands idiom) is INVALID (errors).
- **`5.` is INVALID** (`.5` works). Most calculators accept trailing decimal point.
- **`x\%` INVALID** while `50\%` → 0.5 — percent postfix only folds on literals.
- **`f(x)=x^2` → `Equal(Multiply(f,x), …)`** for undeclared `f` — documented CE convention,
  but the #1 Desmos-corpus trap; importers must pre-declare. Related: undeclared `f(1,2)` →
  function call vs `f(x)` → multiplication (arity-dependent) — should be documented.
- **Ragged matrices accepted**: `\begin{pmatrix}1&2\\3\end{pmatrix}` → Matrix with rows of
  different lengths, valid:true.
- **`docs/LENIENT_PARSER.md` is largely aspirational** but reads as if reviewed-implemented
  in places; the review notes accurately describe what exists except: `*`→times works, `**`
  works, `>=`/`<=` work *even in strict mode* (undocumented), `->` works lenient-only,
  `!=`/`==`/`oo`-adjacent Greek words work per doc; `cbrt`, word-boundary safety verified.
  The `x1→x_1` recommendation (lines 144-150) is contradicted by the implemented `x2→x²`
  rule (P1-G).
- **`docs/desmos-compat-notes.md`: all claims verified true** (tuples in args with plain and
  `\left(` delimiters; `D_{etectsize}` → identifier, single-char subscript still Euler `D`;
  `hsv(1,1,1)\,` unwrapped; unbalanced `\right` errors as documented).

## Tests encoding questionable expectations

- `test/compute-engine/latex-syntax/operators.test.ts:204-205` — locks `--x` → `PreDecrement`
  (P0-B parse side).
- `test/compute-engine/relational-operators.test.ts:289-324` — mixed-chain suite only covers
  same-direction chains; comment implies the class is fixed (P0-A gap).
- `test/compute-engine/latex-syntax/supsub.test.ts:39-84` — pre-sup/pre-sub snapshots leak a
  literal `_` symbol (`_p^qx` → `["Multiply","_","x",…]`); already marked `@fixme: nope...`,
  i.e. known-wrong and locked into the green baseline.
- `test/compute-engine/latex-syntax/trigonometry.test.ts:77` — `@fixme` postfix-degree
  precedence.

## Verified working (no findings)

- Precedence/implicit-mult battery: `1/2x`→1/(2x), `a/bc`→a/(bc) (consistent convention),
  `2\pi r^2`, `\sin 2x`, `\sin x \cos y` (arg stops at next trig), `\sin^2 x`,
  `\sin^{-1} x`→Arcsin (and 2-arg `\arctan(y,x)`→Arctan2), `-2^2`→−4, `2^{-2}`, `a^{b^c}`,
  `5!!`→15, `(3!)!`→720, mixed numbers `1\frac12`→3/2 (and serializer only emits `2\frac34`
  for the Add-meaning InvisibleOperator, so no round-trip trap), `||a|-|b||` and
  `\left|...\right|` nesting, `\frac{d}{dx}` forms, `x^{-1}`→1/x.
- Function application: declared `f(x)`→apply, `f(3)`→9, `\pi(3)`→3π, `\log_2 8`→3,
  `e^2`→e², `i^2`→−1, `f_1(x)` declared/undeclared behave consistently with `f(x)`.
- Numbers: `.5`, `1e5`/`1E5`, `3\times10^4(+1)` scientific, `50\%`, `45°`/`45^\circ`
  (π/4 exact), `\sin(45°)`→√2/2, DMS `30^\circ15'`, `1.2\overline{34}` repeating,
  `angularUnit='deg'` applies to plain args but not to `^\circ`-annotated ones (correct,
  no double conversion), `-0`→0, `\infty`.
- Relational/sets: same-direction chains n-ary with correct truth values; `x∈(1,5)`→Interval
  vs `(1,5)`→Tuple context discrimination; `(1,5\rbrack`, `\lbrack1,5)` half-open intervals;
  `\ni`, `\notin`; `(1,2).x`/`.y`→First/Second (Desmos point access); piecewise
  `\{x>0:1,x<0:-1\}`→Which.
- Error contract: `\frac{1}{}`, `\frac{}{2}`, `x+`, `\sqrt`, `\foo{x}`, `{`, `}`, `&`,
  `x^`, `x_`, unmatched `\left`/`\right`, `((x)`, `$x$`, `\\` all produce Error expressions
  with `isValid:false` — no silent token dropping observed in this battery.
- Serializer round-trip (b8): rationals (incl. negative), rational powers, `Root`, nested
  `Divide`, `Negate(Power)`, `Factorial` wrapping, `Complex`, `Interval`, `Sum`+`Limits`,
  `Mod`, `Congruent`, `Subscript`, `At`, `PlusMinus`, `InvisibleOperator` all reparse to the
  same value. (Structural-only diffs like `Range`→List-of-elements, `f'`→Prime, `1e400`→
  `10^{400}`, 21-digit precision truncation are value-preserving or belong to the round-trip
  precision reviewer.)
- Lenient mode per doc: `sin(x)`, `sqrt(4)`, `cbrt(8)`, `abs`, `floor`, `gcd`, `arcsin/asin`,
  `pi`, `alpha`, `oo` (word-boundary safe: `foo` unaffected), `**`→power, `->`→To,
  `x^(n+1)`, `a_(k+m)`, `x^123`, `x^-1+2`, `a_12`, `log_2(8)`; `loge` correctly NOT log_e.
- `npm run test compute-engine/latex-syntax-standalone`: 29/29 pass.
