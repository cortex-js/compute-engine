# Desmos Compatibility Notes — Tuple Parsing in Function Arguments

Investigated: 2026-05-12. Reporter: GP team, Desmos corpus audit
(`_TASK/desmos/desmos-corpus/AUDIT_PARSE_ERRORS.md`).

## Conclusion

CE already parses tuples inside function-call arguments correctly, both
with plain parentheses and with `\left(\right)` brackets. Regression
tests live in `test/compute-engine/a6-polish.test.ts` under
`describe('Desmos compat — tuples inside function-call arguments')`.

## Per-row breakdown

- `azajxdjjn7/latex@33 Poly Banana`: malformed LaTeX. The expression
  ends `...(-1.65,1.2,1.2\right))` — the inner `(` is never closed
  before `\right)` is consumed. Desmos appears to match `\right`
  against any open delimiter (or no delimiter at all); CE matches
  `\left`/`\right` strictly. This is not a tuple-parsing gap; it is a
  delimiter-matching laxness gap. Recommend the importer detect and
  repair unbalanced `\right` rather than relaxing CE.

- `khpocp8io0/latex@37`, `khpocp8io0/latex@38` (Gomoku): tuples written
  as `\left(a, b, c\right)`. The tuple structure itself always parsed
  correctly (`Triangle` with 3 `Tuple` operands). The audit's "tuple"
  classification was a misattribution: the rows were invalid because the
  symbol `D_{etectsize}` collided with the derivative operator. CE's Euler
  derivative parser (`D_x f`) engaged on the `D` + subscript and misread the
  multi-letter subscript as a differentiation variable, swallowing the
  following term as the function to differentiate (e.g. `D_{etectsize}-7`).

  **Fixed.** The Euler derivative parser now only engages when the subscript
  is a single symbol; a multi-character subscript is parsed as an ordinary
  identifier. Both Gomoku rows now parse with `isValid === true` and zero
  error nodes. Regression tests:
  `test/compute-engine/a6-polish.test.ts` →
  `describe('Desmos compat — D_{...} subscripted identifiers vs Euler derivative')`.

## Separately fixed during this investigation

- **Trailing visual space wrapped color constructors in a `Tuple`.**
  `\operatorname{hsv}(1,1,1)\,` produced `["Tuple", ["Hsv", 1, 1, 1]]`
  instead of `["Hsv", 1, 1, 1]`. A trailing `\,` surfaced as a
  `HorizontalSpacing` operand of an invisible operator; once it was stripped,
  the lone non-numeric color value fell through to the `Tuple` fallback in
  `canonicalInvisibleOperator`. Visual-space operands are now dropped before
  that decision, so a single significant operand is returned unchanged.
  Regression tests:
  `describe('Desmos compat — trailing visual space does not wrap in Tuple')`.

  Note: genuine juxtaposition of a color value with another term (e.g.
  `\operatorname{hsv}(1,1,1)x`) still produces `["Tuple", ["Hsv", …], "x"]`
  because `color` is not a recognized multiplicand type. Whether color × scalar
  should be multiplication is a separate semantic question, not addressed here.

---

# Desmos Compatibility Notes — Dot-Number Lexing

Investigated: 2026-07-07. Reporter: GP team, Desmos-corpus parse audit
(311 failing probes in a 585-graph corpus: 183 leading-dot, 128 trailing-dot).

## Behavior

Desmos accepts numbers written with a bare leading or trailing decimal dot.
CE now lexes both:

- **Trailing-dot numbers** — `1.` is the number `1`. Works wherever a number
  literal appears, including before a delimiter or operator:
  `x>1.`, `z^{1.}`, `\{1.65>x>1.\}`, `\frac{[1,-1,-1,1]1.}{t+1}`.
- **Leading-dot numbers** — `.85` is `0.85`, at any position a number literal
  can start: `.85`, `.5+.5`, `[.1,.2]`. (Leading-dot already worked before this
  change; it is documented here for completeness.)

Serialization is unchanged: a trailing/leading-dot number round-trips as a
normal number (`ce.parse('x>1.').latex` → `1\lt x`, never `1.`).

## Disambiguation rule (the `.` is also member access)

The dot is overloaded: it is both the decimal marker and the member-access
operator (`z.x` → `First(z)`, `1.\operatorname{count}` → `Length(1)`). The
lexer resolves the ambiguity by the token that *follows* the dot, in
`parseNumber` (`src/compute-engine/latex-syntax/parse-number.ts`): when a whole
part is followed by `.` with an empty fractional part,

- **dot followed by a letter, `\operatorname`, or a member command
  (`\max`/`\min`)** → member access: backtrack, leave the `.` for the postfix
  operator (`1.x` → `First(1)`, unchanged).
- **dot followed by another `.`** → leave it (`1..2` errors, unchanged).
- **dot followed by anything else** (a delimiter, an operator, end of input) →
  trailing-dot number: consume the `.`, keep the whole part.

`1.4` is unaffected (non-empty fractional part → one number). `1.2.3` and
`..5` still produce errors, not misparses. Regression tests:
`test/compute-engine/latex-syntax/numbers.test.ts` →
`describe('Desmos dot-number lexing')`, plus the member-access side in
`test/compute-engine/parser-component-access.test.ts`.

## Out of scope: leading-dot as implicit multiplication after an expression

`t^{i}.4` (Desmos: `t^i · 0.4`) does **not** yet parse as implicit
multiplication. After a complete expression, the `.` is peeked by the
member-access postfix operator, which pre-empts the InvisibleOperator
(implicit-multiplication) path in `parseExpression` before a leading-dot number
can be tried. Making it work requires special-casing that gate (allow
InvisibleOperator when the only operator ahead is a `.` immediately followed by
a digit), which was judged too risky for this change. It remains handled at the
importer boundary (see `tycho/requirements/todo/DESMOS_IMPORTER.md`).
