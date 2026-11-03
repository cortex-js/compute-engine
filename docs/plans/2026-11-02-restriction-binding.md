# A trailing restriction `e\{c\}` binds to its group

**Status:** specification, 2026-11-02, written from Tycho's boundary table
(session tycho-f9). Accepted in principle by the user on 2026-11-02; the
implementation is a separate item. Tycho is the only user of the restriction
syntax, so the rule is written from its use. Part of the language narrowing
of `docs/plans/2026-11-01-language-axes-survey.md`, §6.3.

## 1. The rule

`\{c\}` is a postfix that binds looser than every arithmetic operator (`+`,
`-`, `\cdot`, juxtaposition, inline `/`, `^`, unary minus) and looser than a
relation (`=`, `<`, `\le`, `>`, `\ge`, `\ne`, `\sim`, chained forms), and
tighter than `where`, `\to`, `\operatorname{for}` and the comma. It applies
to the whole of the smallest group that holds it. A group is:

- the whole statement, the relation included, up to a `where` clause;
- one operand of a connective (`\lor`, `\land`, the operand of `\neg`): the
  brace binds tighter than a connective, so `x>0\{x<1\}\lor x>2\{x<3\}` is
  `Or(If(x<1, x>0), If(x<3, x>2))`, which with the absent boolean read as
  `False` is Desmos's (0<x<1) or (2<x<3). The corpus writes this `Or` as a
  comma group inside the condition braces (the next rule but one), not with
  `\lor`; the `\lor` spelling gets the same parse;
- one side of `\to`;
- the body of `for` or `where`;
- one comma-separated item, also inside the braces of a condition, where
  the comma means `Or`: `|y+3|\le.2\{x>0\{x<1\}, x>2\{x<3\}\}` is
  `If(Or(If(x<1, x>0), If(x<3, x>2)), LessEqual(Abs(y+3), 0.2))` (corpus
  row neyret/akconkhexx #721856020, found by the implementer on 2026-11-02);
- the condition before the `:` of a piecewise arm, like the arm after it:
  `\{x>0\{c\}: 5, 1\}` is `Which(If(c, x>0), 5, True, 1)`. Corpus row
  neyret/xhlkk7k9aq #1752170633, Desmos
  `.7=c_3\{0<\{c_1<1\}\{c_2<1\}: …, …, 1\}`, whose condition is
  `If(c_2<1, Less(0, If(c_1<1, 1)))` (the two inner `\{…\}` with no
  expression before them are the value 1 where the condition holds, the
  rule of the paragraph after the table). Without this rule the parse was
  `Set(If(c, Colon(x>0, 5)), 1)`: the piecewise was lost and the stored row
  did not read back (the implementer, 2026-11-02);
- the content of a delimiter or a LaTeX argument: `()`, `[]`, `||`, a part
  of `\frac{}{}`, `\sqrt{}`, a superscript `{}`, a function argument, a
  piecewise arm, the condition of a restriction;
- the body of a big operator (`\sum`, `\prod`, `\int` before `dx`);
- the whole row when none of these encloses it.

A condition group (the content of the condition braces, each comma item in
it, and the condition before a piecewise `:`) accepts `If(c, relation)` as a
condition, the form that a restriction inside a condition produces. Its
value where `c` does not hold is the absent boolean, which the two-valued
rule of `docs/plans/2026-11-02-language-axes-options.md` page 3 (plan item
3.4) reads as `False`. Until that item lands, the interpreter gives the
absent-condition error there and the GLSL target declines; the
xhlkk7k9aq row above shows it where `c_2 ≥ 1`.

The parse is `If(c, e)` directly, with no `When` alias: Tycho classifies rows
in structural (non-canonical) form, so an alias that only canonicalization
removes would reach it. `When` is dropped (survey §6.3, item 5).

The serializer never writes the brace. Every single-branch `If(c, e)` is
written `e \text{ where } c`, in parentheses when the clause is not the whole
statement (`((a \text{ where } c), b)`, since a comma inside a `where`
clause starts another item). The brace is a spelling for import only
(Tycho's `requirements/todo/RESTRICTION_SYNTAX.md`), so a stored row never
holds one; it still parses to the same `If`. The rule is in
`docs/plans/2026-11-02-where-binding.md`, section "The LaTeX of `If(c, e)`
with no `Block`" (user decision 2026-11-02). `where` and the brace have the
same scope, so the same text reads back in both places.

Stacked restrictions merge: `e\{c_1\}\{c_2\}` is `If(And(c_1, c_2), e)`. The
order inside `And` is the order written. `\{c\}` alone, with no expression,
is `If(c, 1)`, which is Desmos's value (1 where `c` holds). `a\{\}` is a
parse error, as today.

Why the whole statement and not one operand of the relation (Tycho's
change of 2026-11-02, which replaced its first table): the `where` clause
(`docs/plans/2026-11-02-where-binding.md`) and a future `if` keyword both
cover the whole statement, and Tycho needs one rule anyway that moves a
statement-level wrapper of a definition (`f(x)=…`, `a=…`) into the
definition's body. With one scope for the three notations, Tycho finds a row
restriction in one place, the root of the row inside any `where` bindings,
and reads every other single-branch `If` as a piecewise value. The parser
cannot tell a definition from a relation (`y=…`), and need not: both are
`If(c, Equal(lhs, rhs))`, and Tycho moves the wrapper for a definition.
Desmos treats `\{c\}` as a factor that is 1 where `c` holds and undefined
elsewhere (Tycho's recollection, not checked live), so the value of every
arithmetic row below equals Desmos's; the group only decides where Tycho
finds the condition.

## 2. The cases

"Today" is `ce.parse(latex, {canonical: false})` on 0.176.0. The corpus
counts are rows among the 8,231 rows of Tycho's two Desmos corpora, of which
761 hold a restriction.

| LaTeX                                       | Today                                  | Parse                                     | Corpus |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------- | -----: |
| `y=x\{c\}`                                  | `Equal(y, When(x, c))`                 | `If(c, Equal(y, x))`                      |    133 |
| `x^2+y^2<9\{c\}`                            | `Less(Add(…), When(9, c))`             | `If(c, Less(Add(x^2, y^2), 9))`           |    111 |
| `a\le y\le b\{c\}`                          | chained, `When(b, c)`                  | `If(c, LessEqual(a, y, b))`               |     13 |
| `f(x)=x^2\{c\}`                             | `Equal(f(x), When(x^2, c))`            | `If(c, Equal(f(x), x^2))`                 |        |
| `f(x)=x^2\{c\}+1`                           | `Add(When(x^2, c), 1)`                 | `If(c, Equal(f(x), x^2+1))`               |     34 |
| `F(x)\sim h\{c\}`                           | `Tilde(F(x), When(h, c))`              | `If(c, Tilde(F(x), h))`                   |     12 |
| `a:=1\{c\}`                                 | not used by Tycho                      | `Assign(a, If(c, 1))`: `\coloneq` reads its right side as one group |      0 |
| `a\{c\}+b`, `a+b\{c\}`                      | `Add(When(a, c), b)`, `Add(a, When…)`  | `If(c, a+b)`                              |        |
| `a\{c\}\cdot b`                             | `Multiply(When(a, c), b)`              | `If(c, a·b)`                              |        |
| `-a\{c\}`                                   | `Negate(When(a, c))`                   | `If(c, -a)`                               |     25 |
| `a^2\{c\}`                                  | `When(Power(a, 2), c)`                 | `If(c, a^2)`                              |        |
| `a^{2\{c\}}`                                | `Power(a, When(2, c))`                 | `Power(a, If(c, 2))`                      |      3 |
| `\sqrt{a}\{c\}`, `\sqrt{a\{c\}}`            |                                        | `If(c, Sqrt(a))`, `Sqrt(If(c, a))`        |        |
| `y=(z-0.03)b\{z>0.01\}`                     | `Multiply(…, When(b, c))`              | `If(c, Equal(y, (z-0.03)·b))`             |     52 |
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
| `p\{c\} \text{ where } p \coloneq …`        | `Block(…)` over the whole row          | `If(c, p)` in the body of `where` (`docs/plans/2026-11-02-where-binding.md`) | some |
| `\{c_1: a\{c_2\}, b\}`                      |                                        | `Which(c_1, If(c_2, a), True, b)`         |        |
| `\{x>0\{y<1\}: a, b\}`                      | `Set(If(y<1, Colon(x>0, a)), b)`       | `Which(If(y<1, x>0), a, True, b)` (row xhlkk7k9aq); with bare symbols instead of relations the braces are a set-builder, as today |  |
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
restriction of their own, which under the rule covers its group, the whole
inner relation: `If(c_in, Less(x, y-z+2.2))`, an `If` whose arm is a
boolean. When `c_in` is false, that `If` counts as `False` in the outer
condition: the absent value of the boolean domain is `False`, as a
comparison with an undecided operand is `False` (survey §6.3, the
two-valued rule), which is Desmos's behavior. A comma group in the braces
stays `Or` (since 0.73.0; 7 rows).

Non-value arms that a scalar condition must accept: a relation (`Equal`,
`Less`, `LessEqual`, `Greater`, `GreaterEqual`, a chained form), a
regression `Tilde`, an `Assign`, points and lists of points (`Tuple`,
`PointList`), the drawing heads (`Polygon`, `Triangle`, `Segment`,
`GeometricVector`, `Sphere`, `Histogram`), and a conditional action's `To`
arm.

## 3. What this closes and what it needs

- Tycho removes its restriction-moving walk (`src/plot-core/normalize-restrictions.ts`,
  its roadmap entry IL, a defect: the walk lifts `n>1` out of the
  comprehension that binds `n`), the `a/b\{c\}` fix in
  `desmos-import/normalize/basic.ts`, and the `m(t)\{…\}` branch of its
  document manager, and reads the root of the row, inside any `where`
  bindings, instead. Tycho updates its roadmap entry IL to the
  whole-statement rule.
- After the release Tycho re-checks: the 63 single-branch piecewise
  expressions, the 76 stacked restrictions, and the rows whose right side has
  several terms (at least 103).
- The `where` clause that one row of the table uses is
  `docs/plans/2026-11-02-where-binding.md`, a specification of its own that
  ships in the same release. Compute Engine adds no `with` keyword; Tycho's
  importer turns `\operatorname{with}` into `where`.
- Tests of the implementation use the corpus rows named in the table, not
  crafted LaTeX.
