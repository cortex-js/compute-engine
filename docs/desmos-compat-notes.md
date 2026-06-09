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
