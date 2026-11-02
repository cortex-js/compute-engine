# A trailing restriction `e\{c\}` binds to its group

**Status:** specification, 2026-11-02, written from Tycho's boundary table
(session tycho-f9). Accepted in principle by the user on 2026-11-02; the
implementation is a separate item. Tycho is the only user of the restriction
syntax, so the rule is written from its use. Part of the language narrowing
of `docs/plans/2026-11-01-language-axes-survey.md`, §6.3.

## 1. The rule

`\{c\}` is a postfix that binds looser than every arithmetic operator (`+`,
`-`, `\cdot`, juxtaposition, inline `/`, `^`, unary minus) and tighter than a
relation (`=`, `<`, `\le`, `>`, `\ge`, `\ne`, `\sim`, chained forms), `\to`,
`\operatorname{for}`, `\operatorname{with}` and the comma. It applies to the
whole of the smallest group that holds it. A group is:

- one operand of a relation;
- one side of `\to`;
- the body of `for` or `with`;
- one comma-separated item;
- the content of a delimiter or a LaTeX argument: `()`, `[]`, `||`, a part
  of `\frac{}{}`, `\sqrt{}`, a superscript `{}`, a function argument, a
  piecewise arm, the condition of a restriction;
- the body of a big operator (`\sum`, `\prod`, `\int` before `dx`);
- the whole row when none of these encloses it.

The parse is `If(c, e)` directly, with no `When` alias: Tycho classifies rows
in structural (non-canonical) form, so an alias that only canonicalization
removes would reach it. `When` is dropped (survey §6.3, item 5).

Stacked restrictions merge: `e\{c_1\}\{c_2\}` is `If(And(c_1, c_2), e)`. The
order inside `And` is the order written. `\{c\}` alone, with no expression,
is `If(c, 1)`, which is Desmos's value (1 where `c` holds). `a\{\}` is a
parse error, as today.

Why the operand of a relation and not the whole relation: the parser cannot
tell a definition (`f(x)=…`, `a=…`) from a relation (`y=…`), and with this
choice both parse the same, `Equal(lhs, If(c, rhs))`. Tycho reads a
single-branch `If` that is the whole root of the row, or the whole last
operand of the root relation, as a row restriction, and every other
single-branch `If` as a piecewise value. Desmos treats `\{c\}` as a factor
that is 1 where `c` holds and undefined elsewhere (Tycho's recollection, not
checked live), so the value of every arithmetic row below equals Desmos's;
the group only decides where Tycho finds the condition.

## 2. The cases

"Today" is `ce.parse(latex, {canonical: false})` on 0.176.0. The corpus
counts are rows among the 8,231 rows of Tycho's two Desmos corpora, of which
761 hold a restriction.

| LaTeX                                       | Today                                  | Parse                                     | Corpus |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------- | -----: |
| `y=x\{c\}`                                  | `Equal(y, When(x, c))`                 | `Equal(y, If(c, x))`                      |    133 |
| `x^2+y^2<9\{c\}`                            | `Less(Add(…), When(9, c))`             | `Less(Add(x^2, y^2), If(c, 9))`           |    111 |
| `a\le y\le b\{c\}`                          | chained, `When(b, c)`                  | `LessEqual(a, y, If(c, b))`               |     13 |
| `f(x)=x^2\{c\}`                             | `Equal(f(x), When(x^2, c))`            | `Equal(f(x), If(c, x^2))`                 |        |
| `f(x)=x^2\{c\}+1`                           | `Add(When(x^2, c), 1)`                 | `Equal(f(x), If(c, x^2+1))`               |     34 |
| `F(x)\sim h\{c\}`                           | `Tilde(F(x), When(h, c))`              | `Tilde(F(x), If(c, h))`                   |     12 |
| `a:=1\{c\}`                                 | not used by Tycho                      | `Assign(a, If(c, 1))`                     |      0 |
| `a\{c\}+b`, `a+b\{c\}`                      | `Add(When(a, c), b)`, `Add(a, When…)`  | `If(c, a+b)`                              |        |
| `a\{c\}\cdot b`                             | `Multiply(When(a, c), b)`              | `If(c, a·b)`                              |        |
| `-a\{c\}`                                   | `Negate(When(a, c))`                   | `If(c, -a)`                               |     25 |
| `a^2\{c\}`                                  | `When(Power(a, 2), c)`                 | `If(c, a^2)`                              |        |
| `a^{2\{c\}}`                                | `Power(a, When(2, c))`                 | `Power(a, If(c, 2))`                      |      3 |
| `\sqrt{a}\{c\}`, `\sqrt{a\{c\}}`            |                                        | `If(c, Sqrt(a))`, `Sqrt(If(c, a))`        |        |
| `y=(z-0.03)b\{z>0.01\}`                     | `Multiply(…, When(b, c))`              | `Equal(y, If(c, (z-0.03)·b))`             |     52 |
| `\frac{a}{b}\{c\}`                          | `When(Divide(a, b), c)`                | `If(c, a/b)`                              |        |
| `\frac{a\{c\}}{b}`, `\frac{a}{b\{c\}}`      |                                        | `Divide(If(c, a), b)`, `Divide(a, If(c, b))` |     |
| `a/b\{c\}` (inline)                         | `Divide(a, When(b, c))`                | `If(c, a/b)`                              |        |
| `(a\{c\})`, `(a)\{c\}`                      |                                        | `If(c, a)`                                |        |
| `(a+b)\{c\}+d`                              | `Add(When(Add(a, b), c), d)`           | `If(c, (a+b)+d)`                          |        |
| `\|a\{c\}\|`                                |                                        | `Abs(If(c, a))`                           |        |
| `[a\{c\}, b]`                               | `List(When(a, c), b)`                  | `List(If(c, a), b)`                       |      4 |
| `[a, b]\{c\}`                               | `When(List(a, b), c)`                  | `If(c, List(a, b))`, element-wise if `c` is a list |  |
| `(1,2)\{c\}`                                | `When(Tuple(1, 2), c)`                 | `If(c, Tuple(1, 2))`                      |     79 |
| `(a\{c\}, b)`                               | `Tuple(When(a, c), b)`                 | `Tuple(If(c, a), b)`                      |     15 |
| `f(a\{c\}, b)`, `f(a, b)\{c\}`              |                                        | `f(If(c, a), b)`, `If(c, f(a, b))`        |        |
| `\sum_{n=1}^{N} a_n\{c\}`                   | `Sum(When(a_n, c), …)`                 | `Sum(If(c, a_n), …)` (body; `c` may use `n`) |    6 |
| `\int_0^1 f(x)\{c\}\,dx`                    |                                        | body, before `dx`                         |      0 |
| `n\{n>1\}\operatorname{for}n=[1,2,3]`       | `Equal(B, When(n, …))` in the body     | `If(n>1, n)` in the comprehension body    |        |
| `[n\operatorname{for}n=…]\{c\}`             |                                        | `If(c, the comprehension)`                |        |
| `p\{c\}\operatorname{with}p=…`              | `with` parses as juxtaposition         | `If(c, p)` in the body of `with`          |   some |
| `\{c_1: a\{c_2\}, b\}`                      |                                        | `Which(c_1, If(c_2, a), True, b)`         |        |
| `\{c_1: a, b\}\{c_2\}`                      | `When(Which(…), c_2)`                  | `If(c_2, Which(c_1, a, True, b))`         |     14 |
| `\{c_1: a\}\{c_2\}`                         |                                        | `If(And(c_1, c_2), a)`                    |        |
| `a\{c_1\}\{c_2\}`                           | `When(When(a, c_1), c_2)`              | `If(And(c_1, c_2), a)` (up to 4 deep)     |     76 |
| `a\{c_1\}+b\{c_2\}`                         |                                        | `If(And(c_1, c_2), a+b)`                  |        |
| `\{c\}` alone                               |                                        | `If(c, 1)`                                |        |
| `a\{\}`                                     | parse error                            | parse error                               |        |

Conditions: a list condition (`x\{[1,2,3]>1\}`) keeps the element-wise
meaning of survey §6.3 (a flat list of booleans); 16 rows. No condition in
the corpus is a nested list or a bare `Which`; 18 conditions contain a
piecewise inside a relation (`\{\{…: 1, 0\} = 1\}`), and 4 contain a
restriction of their own, which under the rule covers its group, the right
operand of the inner relation: `Less(x, If(c_in, y-z+2.2))`. A comparison
with an unmatched value is then `false`, which is Desmos's behavior and
survey §6.3's two-valued rule. A comma group in the braces stays `Or`
(since 0.73.0; 7 rows).

Non-value arms that a scalar condition must accept: points and lists of
points (`Tuple`, `PointList`), the drawing heads (`Polygon`, `Triangle`,
`Segment`, `GeometricVector`, `Sphere`, `Histogram`), and a conditional
action's `To` arm. Relation and regression arms no longer occur, since the
`If` is inside the relation.

## 3. What this closes and what it needs

- Tycho removes its restriction-moving walk (`src/plot-core/normalize-restrictions.ts`,
  its roadmap entry IL, a defect: the walk lifts `n>1` out of the
  comprehension that binds `n`), the `a/b\{c\}` fix in
  `desmos-import/normalize/basic.ts`, and the `m(t)\{…\}` branch of its
  document manager, and reads the root or the last relation operand instead.
- After the release Tycho re-checks: the 63 single-branch piecewise
  expressions, the 76 stacked restrictions, and the rows whose right side has
  several terms (at least 103).
- `\operatorname{with}` is parsed as juxtaposition today; the `with` row of
  the table needs `with` to be parsed at all. That is a separate item.
- Tests of the implementation use the corpus rows named in the table, not
  crafted LaTeX.
