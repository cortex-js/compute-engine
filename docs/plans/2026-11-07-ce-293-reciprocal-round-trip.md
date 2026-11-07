# CE-293: a product with a reciprocal does not keep its form through LaTeX

This document holds the investigation of issue `issues/CE-293.md`, moved out of the issue file on 2026-11-07 because an issue body is at most 150 words (`docs/ISSUE_TRACKING.md`, "Rules for the body"). The issue file keeps the witness, the options and the recommendation.

## The investigation (2026-11-07, at 7dd602bcc83977440cbdc48ba248287bdd44063c)

Probes with `ce.box(...)`, `.latex` and `ce.parse(...)`:

| Case | Canonical form | LaTeX | Read back | Same |
| --- | --- | --- | --- | --- |
| CE-293.1 | `Multiply(3, x, Divide(1, y))` | `\frac{3x}{y}` | `Divide(Multiply(3, x), y)` | no |
| CE-293.1 | `Multiply(x, Power(y, -2))` | `\frac{x}{y^2}` | `Divide(x, Power(y, 2))` | no |
| CE-293.2, `reciprocal` | `Divide(a, b)` | `a\times b^{-1}` | `Multiply(a, Divide(1, b))` | no |
| CE-293.2, `factor` | `Divide(a, b)` | `\frac{1}{b}a` | `Multiply(a, Divide(1, b))` | no |
| CE-293.3, every style | `Multiply(c, Divide(a, b))` | `c\frac{a}{b}` | `Multiply(c, Divide(a, b))` | yes |

CE-293.3 no longer reproduces. CE-293.1 and CE-293.2 reproduce. The value is
the same in each case: `simplify()` of both sides gives the same expression.

The serializer cannot fix CE-293.1 and CE-293.2 alone. The engine has two
canonical forms for one quotient: `canonicalPower` changes `Power(y, -1)` to
`Divide(1, y)`, and `canonicalMultiply()`
(`src/compute-engine/boxed-expression/arithmetic-mul-div.ts`) does not merge a
`Divide` factor with the other factors, while `\frac{3x}{y}` canonicalizes as a
`Divide`. A LaTeX string that reads back as the product form must show the
reciprocal as a separate factor.

These two cases are an accepted limit by the maintainer decision of
2026-08-04, recorded in `docs/mathnet/README.md` ("Not every listed class is a
defect") and in `docs/mathnet/roundtrip-exceptions.json`, classes
`quotient-factor-merged-into-fraction` and `fraction-fallback-inverse-power`,
both `reason: documented-lossy`. The first class is CE-293.1: a `Multiply` with
a reciprocal factor is written as one fraction over the whole product. It holds
the corpus row `tycho-seed:tycho-00002`, a Tycho tree with the same shape
(`p(...)·2^{-i}` written `\frac{p(...)}{2^{i}}`). The second class is the
CE-293.2 mechanism: a quotient written as `(a)(b)^{-1}` reads back as a
`Multiply`. The `reciprocal` and `factor` styles write that form because the
host asks for it. A fix of the cause is the old ROADMAP design CE-113 (one
canonical form for a quotient: `canonicalMultiply()` returns a `Divide` for a
product with a reciprocal factor), which the user marked "not now". Its record
names four tasks that must come first; the most important is that the
derivative of a nested radical took exponential time with the fold (depth 12:
670 ms to 2,760 ms, and `derivatives.test.ts` did not finish).

Thus a fix reverses a user decision, and the board must choose.

### Options

Example for each option: `ce.box(['Multiply', 3, 'x', ['Power', 'y', -1]])`.
Today its LaTeX is `\frac{3x}{y}`, and `ce.parse` of that LaTeX gives
`Divide(Multiply(3, x), y)`; `isSame` is `false`.

- **(a) Close: keep the 2026-08-04 decision.** No code change. The LaTeX stays
  `\frac{3x}{y}`; `isSame` after the round trip stays `false`. A host that must
  compare the forms calls `simplify()` on both sides first (both give
  `Divide(Multiply(3, x), y)`). The close reason names the decision and the
  two exception classes.
- **(b) Do CE-113: one canonical form for a quotient.** `ce.box` of the example
  gives `Divide(Multiply(3, x), y)`, so the round trip gives `isSame` `true`,
  and CE-293.2 is also fixed. Size L: the four tasks of the CE-113 record first
  (the exponential derivative time, `Power(y, -n)` with `n ≠ 1` in the
  denominator, exact literals in `.N()`, three integrals to measure again),
  then about 7 snapshots and 3 assertions change. It changes the canonical
  form that `isSame`, hashing and pattern rules see.
- **(c) Write the product form.** The serializer writes `3x\frac{1}{y}` (or
  `3xy^{-1}`) for a product with a reciprocal factor, so the round trip gives
  the product form back. Every displayed product with a reciprocal gets a
  worse LaTeX, which is the opposite of the 2026-08-04 decision. Not
  recommended.

If nothing is decided, the issue stays in `needs-decision` and the behavior
does not change, as with (a).

**Recommendation: (a).** No real user saw a wrong value: the value is the
same, and only a structural comparison after a round trip sees the
difference. Saying no to (a) means (b), a large change of the canonical form
with a known performance risk.
