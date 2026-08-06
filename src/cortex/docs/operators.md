---
title: Cortex Operators
sidebar_label: Operators
slug: /cortex/operators/
description: "Operators in Cortex: infix, prefix and postfix forms, precedence and associativity, and the whitespace rules that govern how operands are parsed."
hide_title: true
date: Last Modified
---
# Operators

Most operators are infix operators: they have two operands, a left-hand side
(lhs) operand and a right-hand side operand (rhs).

An infix operator can either have whitespace before and after the operator or
have no whitespace neither before nor after the operator.

Infix operators have a precedence that indicate how strongly they bind to their
operand and a left or right associativity.

A few operators are prefix operators: they only have a right-hand side. Prefix
operators are followed immediately by their operand: they cannot be separated by
whitespace.

A postfix operator (`!`, `Factorial`) has only a left-hand side and follows it
immediately: like a prefix operator, it cannot be separated from its operand by
whitespace.

:::info

The whitespace rules are necessary to support unambiguous parsing of expressions
spanning multiple lines without requiring a separator between expressions

:::

The implementation's source of truth for operator spelling, precedence, and
associativity is `src/cortex/operators.ts`. Both the parser and serializer read
that table. The reference table below mirrors it.

## Precedence

The operator at the root of the parse tree has the lowest precedence.

Precedence tiers are numbered in gaps of 10, **loosest to tightest** — a
higher number binds **tighter**. Operators in the same tier have the same
precedence (for example `+` and `-`, or `*` and `/`).

| Tier | Operator            | ASCII  | Fancy | Kind   | Associativity |
| ---- | -------------------- | ------ | ----- | ------ | ------------- |
| 10   | Assign                | `:=`   |       | infix  | right         |
| —    | Assign _or_ Equal     | `=`    |       | infix  | positional    |
| 15   | MapsTo                | `\|->` | `↦`   | infix  | right         |
| 18   | Coalesce              | `??`   |       | infix  | right         |
| 20   | Pipe                  | `\|>`  |       | infix  | left          |
| 20   | Pipe                  | `~>`   |       | infix  | left          |
| 30   | KeyValuePair          | `->`   | `→`   | infix  | left          |
| 40   | Or                    | `\|\|` | `⋁`   | infix  | left          |
| 50   | And                   | `&&`   | `⋀`   | infix  | left          |
| 60   | Equal                 | `==`   |       | infix  | n-ary chain   |
| 60   | Same                  | `===`  | `≣`   | infix  | n-ary chain   |
| 60   | NotEqual              | `!=`   | `≠`   | infix  | n-ary chain   |
| 60   | Less                  | `<`    |       | infix  | n-ary chain   |
| 60   | Greater               | `>`    |       | infix  | n-ary chain   |
| 60   | LessEqual             | `<=`   | `⩽`   | infix  | n-ary chain   |
| 60   | GreaterEqual          | `>=`   | `⩾`   | infix  | n-ary chain   |
| 60   | Element               | `in`   | `∈`   | infix  | n-ary chain   |
| 60   | Element (type test)   | `is`   |       | infix  |               |
| 60   | NotElement            | `!in`  | `∉`   | infix  | n-ary chain   |
| 65   | Range                 | `..`   | `‥`   | infix  | left          |
| 70   | Add                   | `+`    |       | infix  | left          |
| 70   | Subtract              | `-`    | `−`   | infix  | left          |
| 80   | Multiply              | `*`    | `×`   | infix   | left          |
| 80   | Divide                | `/`    | `÷`   | infix   | left          |
| 80   | Mod                   | `%`    |       | infix   | left          |
| 90   | Negate                | `-`    | `−`   | prefix  |               |
| 90   | Not                   | `!`    | `¬`   | prefix  |               |
| 100  | Power                 | `^`    |       | infix   | right         |
| 100  | Power                 | `**`   |       | infix   | right         |
| 110  | Factorial             | `!`    |       | postfix |               |

Postfix calls and indexing (`f(x)`, `xs[i]`) bind tighter than every entry in
this table — they are handled directly by the parser rather than through the
operator table, since they are not spelled with an operator symbol.

## The whitespace rule

An infix operator must have whitespace on **both** sides or on **neither**
side. A prefix operator must have **no** whitespace before its operand. These
rules let a multi-line program parse deterministically without a separator
between every expression:

```cortex
a + b     // infix Add: ["Add", "a", "b"]
a+b       // same: whitespace on neither side
```

<!-- cortex-test: expect-diagnostics -->

```cortex
a +b
```

Here `+` has whitespace before but not after: it is **not** treated as infix.
The expression `a` ends there; `+b` is left over on the same line with no
separator before it, which is a diagnostic (`unexpected-symbol`) rather than a
silently-inferred sequence — see [Statements and Sequencing](/cortex/syntax/).
On its own line (after a linebreak or `;`), `+b` is a valid new statement:
unary `+` is the identity, so `a\n+b` parses as `["Block", "a", "b"]`.

```cortex
a+ b
```

Here `+` has whitespace after but not before: an **asymmetric** case. The
parser recovers as infix `Add` but reports an
`asymmetric-operator-whitespace` diagnostic (with a fix-it), since this is
more useful to the author than silently ending the statement.

## Pipe: `|>` and `~>`

`|>` and `~>` are aliases for `Pipe` and sit at the **loosest** precedence
tier, right below `Assign` — looser than arithmetic, relational, and boolean
operators (Elixir-style):

```cortex
a + b |> f       // (a + b) |> f
a || b |> f      // (a || b) |> f
x = a |> f       // x = (a |> f)
```

## Absence coalescing: `??`

`a ?? b` is `Coalesce(a, b)`: the value of `a` unless `a` is **absent**
(`Missing` or `NaN`), in which case the value of `b`. It is lazy — `b` is not
evaluated when `a` is present.

```cortex
let timeout = config.timeout ?? 30
let first = xs[1] ?? 0
```

`??` discharges **absence**. It does _not_ rescue an `Error`: an error operand
is an error, not a missing value, and propagates.

It is right-associative, so a chain falls through left to right:

```cortex
a ?? b ?? c      // Coalesce(a, Coalesce(b, c))
```

Its precedence (18) sits between `|->` and `|>`, which fixes the two groupings
that matter:

```cortex
xs |> f ?? 0     // (xs |> f) ?? 0 — the default is for the pipeline's RESULT
x |-> x.a ?? 0   // x |-> (x.a ?? 0) — the default is inside the body
```

Like `|>`, it is looser than `->`, so a dictionary value needs parentheses:

<!-- cortex-test: expect-diagnostics -->

```cortex
{a -> 1, b -> x ?? 2}
```

Write `{a -> 1, b -> (x ?? 2)}` instead. It is also looser than `||` and `&&`
(the C# position), so `a ?? b || c` is `a ?? (b || c)`.

## Type test: `is`

`x is integer` tests at runtime whether a value inhabits a type. It is the
same test a `match` type pattern performs, and lowers to the same
`Element(value, type)` expression:

```cortex
x is integer
x is string && y is boolean
```

The right operand is a **type name**, not an expression, so a typo is a
parse-time diagnostic rather than a comparison against an undeclared symbol.
This first version resolves **simple named types** only: a compound type
(`!error`, `integer | string`, `list<integer>`) parses but reports
`type-pattern-unsupported`, exactly as the equivalent typed pattern does.

`is` is a **contextual** word, not a reserved one — it is recognized only
between an operand and a type name, so `let is = 5` and `f(is)` remain legal.

Since `is` and `in` spell the same `Element` expression, a program serialized
back from MathJSON uses `in` for both.

## Anonymous functions: `|->`

The mapsto operator constructs an anonymous function:

```cortex
x |-> x^2
(x, y) |-> x + y
```

It is right-associative, so `x |-> y |-> x + y` constructs a function that
returns another function. It binds tighter than assignment but more loosely
than the other expression operators, so `f = x |-> x + 1` assigns the complete
function to `f`. Typed parameters can be written in parentheses:

```cortex
(x: integer) |-> x + 1
```

The `MapsTo` name in the table is internal to parsing. The resulting MathJSON
uses `Function`, not a `MapsTo` head.

## Ranges: `..`

The range operator is a compact spelling of a two-argument `Range`:

```cortex
1..5          // Range(1, 5)
1..n - 1      // Range(1, n - 1)
k in 1..5     // k in Range(1, 5)
```

It binds tighter than relational operators and more loosely than addition and
subtraction. The Unicode two-dot leader `‥` is an input alias. Serialization
uses `Range(a, b)`, and a stepped range continues to use the three-argument
call `Range(a, b, step)`.

## Spread: `...`

In a **call argument list** — and only there — a prefix `...` spreads a tuple
into the call's arguments: the tuple's elements become ordinary positional
arguments.

```cortex
f(...t)          // ["f", ["Spread", "t"]]
f(1, ...t, q)    // splices between positional arguments
g(...p, ...q)    // several spreads splice in order
Max(...t)        // variadic built-ins accept spreads
```

Only **tuples** spread — a `List` (or any other value) is an
`incompatible-type` error. A literal tuple splices immediately; a symbolic
argument is spliced when the call evaluates, and until then the call stays
symbolic (the spread never binds positionally to a single parameter). The
three-dot token is distinct from the range operator `..`; outside an argument
list `...` is a diagnostic.

## Unary prefix: `-` and `!`

`-` (`Negate`) and `!` (`Not`) are prefix operators. They must abut their
operand with no whitespace:

```cortex
-x        // ["Negate", "x"]
!a        // ["Not", "a"]
!!a       // ["Not", ["Not", "a"]] — `!!` lexes as one token that peels into two Not's
```

`Negate`/`Not` bind looser than `Power`, so a leading minus does not reach
inside an exponent:

```cortex
-x^2      // -(x^2), i.e. ["Negate", ["Power", "x", 2]]
```

A unary minus applied directly to a number literal folds into the literal
rather than producing a `Negate` node:

```cortex
-2        // the literal -2, not ["Negate", 2]
```

Unary `+` is accepted the same way but is the identity: `+(2 + 1)` is
`["Add", 2, 1]`, not wrapped in anything.

## Power: `^` and `**`

`Power` is the tightest operator in the table and is **right-associative**.
`**` is an accepted alias for `^` (same table row, same precedence):

```cortex
x^2       // ["Power", "x", 2]
x**2      // ["Power", "x", 2]
2^3^2     // ["Power", 2, ["Power", 3, 2]] — right-associative
```

Because `Power` binds tighter than `Multiply`/`Divide`:

```cortex
x^1/2     // (x^1)/2, i.e. ["Divide", ["Power", "x", 1], 2]
```

## Modulo: `%`

`%` is `Mod`, an infix operator at the multiplicative tier (the same
precedence as `*` and `/`), left-associative:

```cortex
a % b       // ["Mod", "a", "b"]
a + b % c   // a + (b % c): ["Add", "a", ["Mod", "b", "c"]]
a % b % c   // ["Mod", ["Mod", "a", "b"], "c"] — left-associative
```

## Factorial: postfix `!`

`!` in **postfix** position is `Factorial`. Position disambiguates it from the
prefix `!` (`Not`): a `!` that abuts the preceding operand is a factorial
(`x!`), while a `!` at the start of an operand is `Not` (`!x`).

```cortex
5!          // ["Factorial", 5]
n!          // ["Factorial", "n"]
!x          // ["Not", "x"] — prefix, unchanged
```

`Factorial` binds tighter than `Power` (tier 110 vs. 100), so it reaches inside
a `Power` operand, and a leading minus stays outside it:

```cortex
2^3!        // 2^(3!): ["Power", 2, ["Factorial", 3]]
3! ^ 2      // (3!)^2: ["Power", ["Factorial", 3], 2]
-3!         // -(3!): ["Negate", ["Factorial", 3]]
```

It also applies after a parenthesized expression, a call, or an index:

```cortex
(a + b)!    // ["Factorial", ["Add", "a", "b"]]
f(x)!       // ["Factorial", ["f", "x"]]
```

Like a prefix operator, a postfix `!` must **abut** its operand: `x!` is a
factorial, but `x !y` is not — the space before `!` ends the `x` expression,
leaving `!y` (a prefix `Not`) with no separator, which is a diagnostic. Because
the lexer maximal-munches a run of operator characters into one token, a `!`
directly followed by another operator character is not seen as a lone `!`
(write `3! ^ 2`, not `3!^2`; `x! + 1`, not `x!+1`). The `!=` (`NotEqual`) and
`!in` (`NotElement`) operators are unaffected: the lexer keeps `!=` whole and
`!in` is recognized as a compound before the postfix `!`.

## Invisible multiplication

A number literal immediately followed — with **no** whitespace — by a symbol
or an opening parenthesis is read as an implicit `Multiply`:

```cortex
2x        // ["Multiply", 2, "x"]
3x^3      // 3·(x^3): ["Multiply", 3, ["Power", "x", 3]]
2i        // ["Multiply", 2, "i"] — `i` is the engine's ImaginaryUnit symbol
2(2 + 1)  // ["Multiply", 2, ["Add", 2, 1]]
```

Note that a symbol immediately followed by `(` is a **function call**, not an
invisible multiplication: `x(2+1)` is `["x", ["Add", 2, 1]]`, and a
parenthesized (or otherwise compound) callee produces `Apply`:
`(a+b)(2+1)` is `["Apply", ["Add", "a", "b"], ["Add", 2, 1]]`. See
[Calls and Indexing](/cortex/syntax/).

Whitespace between the number and the symbol suppresses invisible
multiplication and is instead a statement boundary: `2 1/2` is a diagnostic
(`unexpected-symbol`), not `2 * (1/2)`.

## Chained relational operators

Relational operators (precedence tier 60) are **n-ary chainable**: a run of
the *same* relational operator flattens into one node, matching how
mathematicians write inequalities and how the engine already represents them:

```cortex
a < b < c     // ["Less", "a", "b", "c"]
```

A *mix* of relational operators initially lowers as a left-associated tree:

```cortex
a < b <= c    // ["LessEqual", ["Less", "a", "b"], "c"]
```

When the tree is boxed by the Compute Engine, it is canonicalized to the
pairwise conjunction `a < b && b <= c`. Consequently, evaluating a mixed chain
has the usual mathematical chained-comparison semantics.

## Logic operators

- `&&` (`And`), `||` (`Or`), `!` (`Not`), with the fancy Unicode forms `⋀`,
  `⋁`, `¬`.
- `&&` binds tighter than `||`, matching the tiers above.

The word forms `and`, `or`, and `not`, and the implication/equivalence infix
operators `=>` and `<=>`, are reserved but not implemented. The token `=>` is
used contextually to separate a `match` pattern from its result.

## Assignment vs. equality

Three spellings, two meanings:

- **`:=` always assigns.**
- **`==` always compares** (and `===` is `Same`, structural identity).
- **`=` is positional.** It assigns when it is the top-level operator of a
  **statement** whose left side is a binding target — a name, or a field/index
  path rooted at one. Everywhere else it compares.

So a statement assigns:

```cortex
x = 5
count = count + 1
```

…while the same `=` inside any larger expression is an equation, which is what
a reader of mathematics expects:

```cortex
Solve(x^2 = 4, x)        // Equal — the equation, not an assignment
if a = true { 1 } else { 2 }
[a = 1, b = 2]
```

This is why `=` needs no parentheses to be safe in a condition: `if a = true`
cannot silently assign, and the C footgun does not exist in Cortex.

As a comparison, `=` binds at the relational tier (60) like `==`, so
`if x = 5 && y` groups as `(x = 5) && y`. As an assignment it binds loosest
(10), taking the whole right-hand side.

Two consequences worth knowing:

**A non-binding left side compares, even as a statement.** `x^2 = 4` on its own
line is the equation, because `x^2` is not a name. A bare name always assigns,
so write `==` when you mean the equation:

```cortex
y == 2 * x + 1           // the equation
y = 2 * x + 1            // assigns to y
```

**A chain is diagnosed.** `a = b = 5` would assign `a` the *boolean* `b == 5`,
which is never what a chained assignment means:

<!-- cortex-test: expect-diagnostics -->

```cortex
a = b = 5
```

Write `a := b := 5` to chain the assignment, or `a = (b = 5)` if the comparison
really was intended.

**An assignment in a condition is a warning.** `:=` is unconditional, so it
reaches a condition where a bare `=` no longer can — and Cortex has no
`if init; cond` form, so the assigned value *is* the test:

```cortex
if flag := true { 1 }   // warning: assign-in-condition
```

It is a warning rather than an error, since `:=` is the deliberate spelling.
It fires only where a value is consumed as a boolean — an `if`/`while`
condition — not for `f(a := 1)` or `[a := 1]`, which are unambiguous.

**Serialization uses the explicit spellings.** An expression written back out
by the formatter or serializer always uses `:=` for assignment and `==` for
comparison, never a bare `=` — so a round-trip is exact regardless of position.
`=` is an input convenience.
