# `where`: a local binding and a condition

**Status:** specification, approved by the user on 2026-11-02; not
implemented. It ships in the language release of step 3 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`, with the restriction
rule of `docs/plans/2026-11-02-restriction-binding.md`. The keyword, the
item rules and the `Block` form are the user's decisions of 2026-11-02; the
Tycho session tycho-f9 agreed to each, following Tycho's
`requirements/todo/RESTRICTION_SYNTAX.md`. Witnesses, strength `corpus`:
Graph Paper's stored documents and help pages, which write `\text{ where }`,
and 58 Tycho Desmos rows with `\operatorname{with}`, which Tycho's importer
turns into `where`.

## Today

`where` (`parseWhereExpression()` in
`src/compute-engine/latex-syntax/dictionary/definitions-core.ts`) gives
`Block(Declare(a), Assign(a, v), …, e)`. Only `a \coloneq v` is a binding:
`a \text{ where } b = 2` gives `Block(Equal(b, 2), a)` and binds nothing. A
bound (`(\sin t,\cos t) \text{ where } 0\le t\le\pi`) gives
`Block(LessEqual(0, t, Pi), …)`, which only Tycho's classifier reads. A
trailing `for` is moved inside the `Block` by a look-ahead. A `Block`
serializes as `a\coloneq 2; a+1`.

CE adds no `with` keyword. Tycho's importer keeps its own `with` entry
(`~/dev/tycho/src/graph-paper/desmos-import/with-dictionary.ts`) and turns
it into this form.

## The rule

**Items.** `e \text{ where } item, item, …` (also `\operatorname{where}`).
An item is one of:

- a binding: `name \coloneq v`, `name = v` or `\text{let } name \coloneq v`.
  `name` is a symbol, and it can have a subscript (`x_{0}`, read with
  `binderSymbol()`). The test is syntactic: a symbol on the left;
- every other relation, which is a condition: `0\le t\le\pi`, `\sin x > 0`,
  `x+y = 1`, `f(x) = …`. A condition with `=` on a bare symbol is written
  `x^2\{a=3\}`.

Every comma inside the clause starts another item. A comma followed by text
that is not an item is a parse error: `(a \text{ where } a \coloneq 1, 2)` is
an error, and the pair is written `((a \text{ where } a \coloneq 1), 2)`.
Tycho's importer reads every comma this way, and its 56 rows that parse do
too. A `let` with no value is a parse error.

**MathJSON.** One `Block`: a `Declare` with its value,
`Declare(a, "unknown", v)`, for each binding in written order, then the
body. The second operand of `Declare` is a type, so the value is the third
operand and the type is the inference marker `"unknown"` (a binding written
with a type keeps it in that slot). The conditions, joined with `And` in
written order, wrap the body in `If(c, e)`, the form of the restriction
`e\{c\}`:

```
e \text{ where } a \coloneq v_a, b = v_b, 0\le t\le 1
  → Block(Declare(a, "unknown", v_a), Declare(b, "unknown", v_b),
          If(LessEqual(0, t, 1), e))
```

The declaration carries its value in one statement (user decision
2026-11-02, block locals A′ in `docs/plans/2026-11-02-language-axes-options.md`
page 4: a declaration has a value, and `Declare(a)` followed by
`Assign(a, v)` is not accepted as a pair; a `Declare` without a value is a
static error). Verified on the source of 2026-11-02:
`Block(Declare(p, "unknown", x^2), p + 1)` evaluates and compiles with no
library change, while the two-operand `Declare(p, x^2)` is read as a
malformed type. The `;` parse of `a \coloneq v; e` emits the same form.
Tycho changes its two builders that emit the pair
(`desmos-import/with-dictionary.ts`, `graph/surface-argument-staging.ts`) to
this form, one line each; its `plot-core/classification-entry-fold.ts`
builds `Block(Assign(a, 1), b)`, a first assignment at the block's own
level, which is a declaration under A′ and stays valid.

A later value sees an earlier binding, and a condition can read a bound
name: `b \text{ where } a \coloneq 5, b \coloneq a+1` is 6, as today. This is
the form that step 4 of the contraction plan reduces to "single assignment
before use", and it compiles to plain local variables on the JavaScript,
GLSL, WGSL and Python targets. The compiler keeps one form for a local
binding.

A value that reads its own name does not read the outer value: the
`Declare` hides it. `x+100 \text{ where } x \coloneq \lfloor x+0.5\rfloor`
stays symbolic in the interpreter, and the compiler declines it with a
message that says to choose another name. Tycho's 3 rows of this kind
(`wccrhnzn2q`) bind the plot variables `x`, `y`, `z` in a document variable
`d` defined in another row. Tycho renames them where it replaces `d` by its
definition; CE has no rule for them.

**Scope.** `where` binds looser than arithmetic, relations, the restriction
`\{c\}` and a future `if`/`else`, and tighter than `for`, the comma and `;`
(Tycho's `RESTRICTION_SYNTAX.md` §4.3). The clause covers the whole
statement of a row, the whole body of a `for`, or the whole content of the
delimiter or argument that holds it. The precedence is 21, as today. A
definition keeps its bindings outside the `Equal`; Tycho moves them into the
body of the definition, as it does today.

| LaTeX                                                            | Parse                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `y=p \text{ where } p \coloneq x^2`                              | `Block(Declare(p, "unknown", x^2), Equal(y, p))`                               |
| `\|d \text{ where } x \coloneq \lfloor x+0.5\rfloor\| < 1`       | `Less(Abs(Block(Declare(x, "unknown", Floor(x+0.5)), d)), 1)`                  |
| `[R \text{ where } d \coloneq … \operatorname{for} n=[1...225]]` | `Comprehension(Block(Declare(d, "unknown", …), R), Element(n, …))`: `d` reads `n`, 24 rows |
| `(\cos t,\sin t) \text{ where } 0\le t\le\pi`                    | `If(LessEqual(0, t, Pi), Tuple(Cos(t), Sin(t)))`                               |

**Serialization.** A `Block` whose statements are `Declare(a, "unknown", v)`
declarations with a value followed by one expression is written
`e \text{ where } a \coloneq v_a, b \coloneq v_b`. When that expression is
`If(c, e)`, the condition is the last item:
`e \text{ where } a \coloneq v, 0\le t\le\pi`. The clause is in parentheses
when it is not the whole statement (`2(p \text{ where } p \coloneq 3)`,
`((a \text{ where } a \coloneq 1), 2)`). The text parses back to the same
`Block`. Every other `Block` keeps the `;` form. Stored Graph Paper rows
then have no `;` and no brace.

## The LaTeX of `If(c, e)` with no `Block`

Every single-branch `If(c, e)` is written `e \text{ where } c`, in
parentheses when it is not the whole statement (the user's decision of
2026-11-02). It replaces `\mathrm{If}(c, e)` today, and the brace that the
restriction plan (step 3.2) gave for it. The brace still parses to the same
`If`. There is no serializer option. Reason: Tycho's specification makes the
brace a spelling for import only, so stored rows must not contain one, and
one spelling is also the one inside a `where` `Block`. CE's other users see
`where`, not the brace.

Three exceptions, where the `where` text would not read back (the
implementer, 2026-11-02, accepted): the serializer keeps `\mathrm{If}(c, e)`
when `c` is not a relation, when `c` is `a = v` with a bare symbol on the
left (the `where` reader would take it as a binding), and when `e` is an
`Assign`, a `Declare` or a `Function` (`a \coloneq 5 \text{ where } x>0`
reads back as `Assign(a, If(x>0, 5))`).

A binding whose value is a function literal emits
`Declare(f, "function", v)`, not `"unknown"`: with `"unknown"`, `f(3)` after
`f(u) \coloneq u^2` was read as a juxtaposition (`3(u) => u^2`) instead of
a call.

## What changes for existing users of `where`

1. **The `for` order.** `i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)`
   puts the `for` outside the clause, so the `n` in `Range(n)` is free.
   Tycho's 24 comprehension rows need this order, and the look-ahead for
   `for` in `parseWhereExpression()` is deleted. The test
   `test/compute-engine/a5-where-for-composition.test.ts` (2026-05-12, no
   corpus witness) changes. `(i \operatorname{for} i = \operatorname{Range}(n)) \operatorname{where} n \coloneq 3`
   and `i \operatorname{for} i = \operatorname{Range}(n) \operatorname{where} n \coloneq 3`
   keep the old value.
2. **A condition item** becomes `If(c, e)` instead of a `Block` statement.
3. **`=` binds.** `a \text{ where } b = 2` binds `b`.
4. **The LaTeX of a binding `Block`.** `a\coloneq 2; a+1` is written
   `a+1 \text{ where } a \coloneq 2`, also for a `Block` that a user built
   with `;`.

The tests that show `where` or a `Block` serialization (about ten files under
`test/compute-engine/`) and the guide page
`~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md` change with the
parser. The CHANGELOG names each change.

## Not in this item

- An `if` keyword (`body \text{ if } c`). If it is added later, its form is
  `If(c, body)`.

## What Tycho does after the release

Its importer turns `\operatorname{with}` into this form. Its readers keep
reading the `Block`, with an `If` as the last statement, and read a
binding's value in the inner scope, as CE does. It renames the bound plot
variables of the 3 `wccrhnzn2q` rows where it replaces document definitions,
rewrites its `;` rows to `where`, drops its `;` split
(`splitBlockValueRow`), and re-checks its 58 rows and its stored documents.
