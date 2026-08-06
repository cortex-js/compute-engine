---
title: Cortex for Python Users
sidebar_label: From Python
slug: /cortex/from-python/
description: "A translation guide from Python to Cortex: idiom-by-idiom mappings for variables, collections, control flow, math and strings, plus the reflexes that silently do the wrong thing."
hide_title: true
date: Last Modified
---
# Cortex for Python Users

A working translation guide. Every Cortex example on this page is executed by
the documentation test suite and its `// ➔` output verified, so nothing here
can drift from the implementation.

**What carries over.** The shape of a program: sequential statements,
lexically scoped functions, closures, first-class lambdas, `Map`/`Filter`, a
`for x in collection` loop, arbitrary-precision integers, `%` with Python's
sign convention, negative indices, chained comparisons, and `**` for
exponentiation.

**What to unlearn.** Three things, in order of how much trouble they cause:

1. **Indexing is 1-based.** `xs[1]` is the first element.
2. **Arithmetic is exact and symbolic by default.** `1/3` is the rational one
   third, `Ln(2)` stays `ln(2)`. Floats happen only when you ask, with `N(…)`.
3. **`//` is a comment, not floor division**, and `=` assigns only as a whole statement — inside an expression it is `Equal`, never
   equality. Both fail *quietly* — see [Traps](#traps).

There is no `print`. A program's value is the value of its **last statement**.

## Variables and Functions

| Python | Cortex |
|:--|:--|
| `x = 5` | `let x = 5` |
| `TAU = 6.28` (by convention) | `const tau = 6.28` (enforced) |
| `x: int = 4` | `let n: integer = 4` |
| `def f(x): return x**2` | `f(x) = x^2` |
| `def f(x):` with a body | `function f(x) { … }` — value is the last expression |
| `lambda x: x*2` | `x \|-> 2x` |
| `lambda: 42` | `() \|-> 42` |
| `def f(x: float) -> float:` | `f(x: real) -> real = x^2` |
| `return` | *(no `return`)* — the last expression is the value |
| `math.floor(x)`, `np.mean(xs)` | `Floor(x)`, `Mean(xs)` — no modules, no imports |

Naming convention: `Capitalized` names are library operators, `lowercase`
names are yours. Calling an unknown function is not an error — the call stays
symbolic, with a did-you-mean warning when a close library name exists
(`len` suggests `Length`).

```cortex
fact(n) = if n <= 1 { 1 } else { n * fact(n - 1) }
let double = x |-> 2x
(fact(5), double(21))
// ➔ (120, 42)
```

## Collections

| Python | Cortex |
|:--|:--|
| `[1, 2, 3]` | `[1, 2, 3]` |
| `{1, 2, 3}` (set) | `{1, 2, 3}` |
| `(1, 2)` (tuple) | `(1, 2)` |
| `{"a": 1}` (dict) | `{"a" -> 1}`; empty dictionary is `{->}` |
| `d["a"]` | `d["a"]`, or `d.a` when the key is an identifier |
| `xs[0]` | `xs[1]` — **1-based** |
| `xs[-1]` | `xs[-1]` |
| `xs[1:3]` | `xs[2..3]` — 1-based, **inclusive** on both ends |
| `range(1, 6)` | `1..5` or `Range(1, 5)` — **inclusive** of the end |
| `len(xs)` | `Length(xs)` |
| `sorted(xs)` / `sorted(xs, reverse=True)` | `Sort(xs)` / `Sort(xs, (a, b) \|-> a > b)` |
| `sum`, `min`, `max`, `any`, `all` | `Sum`, `Min`, `Max`, `Any`, `All` |
| `reversed(xs)` | `Reverse(xs)` |
| `zip(a, b)` | `Zip(a, b)` |
| `enumerate(xs)` | `Zip(1..Length(xs), xs)` |
| `xs.index(v)` | `IndexOf(xs, v)` |
| `xs + ys`, `xs.append(v)` | `Join(xs, ys)`, `Append(xs, v)` — both return a **new** collection |
| `xs[2] = 9` | *(no element assignment)* — rebuild with `Map`/`Join` |
| `d.keys()`, `d.values()` | `Keys(d)`, `Values(d)` |
| `dict(zip(ks, vs))` | `DictionaryFrom(Zip(ks, vs))` |
| `collections.Counter(xs)` | `Tally(xs)` → a `(values, counts)` pair |

Collections are **immutable values**. There is no in-place mutation: build a
new collection and rebind the name.

```cortex
let counts = DictionaryFrom(Zip(["apples", "figs"], [3, 1]))
(counts["apples"], Keys(counts), counts["pears"])
// ➔ (3, ["apples","figs"], NaN)
```

A missing numeric dictionary field yields `NaN` rather than raising
`KeyError`; a missing nonnumeric field remains `Missing`. `IsMissing`
recognizes either representation, and `Coalesce(value, fallback)` supplies a
default. See [Traps](#traps).

### Comprehensions

Cortex has no comprehension syntax. Use the pipeline operator `|>` with
`Filter`/`Map`; `_` is the placeholder for the piped value.

```python
sum(n**2 for n in range(1, 11) if n % 2 == 1)
```

```cortex
1..10 |> Filter(_, n |-> n % 2 == 1) |> Map(_, n |-> n^2) |> Sum
// ➔ 165
```

`Range`, `Map`, `Filter`, `Take`, `Drop` and `Join` are **generators**, like
Python's — they enumerate only when materialized (indexed, aggregated, or
iterated). A deferred mapping function reads variables at *materialization*
time, so the same "late binding in a closure" surprise applies:

```cortex
let n = 1
let m = Map(1..3, k |-> k * n)
n = 10
Sum(m)
// ➔ 60
```

## Control Flow

| Python | Cortex |
|:--|:--|
| `if c: … elif d: … else: …` | `if c { … } else if d { … } else { … }` |
| `a if c else b` | `if c { a } else { b }` — `if` is an **expression** |
| `and`, `or`, `not` | `&&`, `\|\|`, `!` (the words are reserved but unimplemented) |
| `for x in xs:` | `for x in xs { … }` |
| `for i in range(n):` | `for i in 1..n { … }` |
| `while c:` | `while c { … }` |
| `break`, `continue` | `break`, `continue` |
| `match … case` (3.10+) | `match … { pattern => body }` |
| `try/except` | *(none)* — errors are ordinary values |
| `# comment` | `// comment` or `/* … */` |

Loops run **for effect**: their value is `Nothing`. Accumulate into a variable
declared outside the loop, or use `Map`/`Filter`/`Reduce`/`Fold` when you want
a value.

```cortex
let total = 0
for k in 1..100 { if k % 3 == 0 || k % 5 == 0 { total = total + k } }
total
// ➔ 2418
```

### Pattern matching

Cortex `match` is close to Python 3.10's `match`/`case`, with three
differences: cases are written `pattern => body` (no `case` keyword and no
colon), a **bare name always binds** (it never compares), and you pin a value
to compare against with `== expr`.

```python
match n:
    case 0: "zero"
    case k if k > 0: "positive"
    case _: "negative"
```

```cortex
classify(n) = match n {
  0 => "zero"
  k if k > 0 => "positive"
  _ => "negative"
}
Map([-2, 0, 5], classify)
// ➔ ["negative", "zero", "positive"]
```

Because a bare name binds, `match x { Pi => … }` does *not* test for π — it
binds a fresh variable named `Pi`. Write `match x { == Pi => … }`. This is the
same rule as Python's (where a bare `case FOO:` is a capture pattern), but it
bites more often because Cortex's constants are ordinary names.

## Math and Numerics

| Python | Cortex |
|:--|:--|
| `7 / 2` → `3.5` | `7 / 2` → the exact rational `7/2`; `N(7 / 2)` → `3.5` |
| `7 // 2` → `3` | `Floor(7 / 2)` — **`//` starts a comment in Cortex** |
| `7 % 2`, `-7 % 3` → `2` | `7 % 2`, `-7 % 3` → `2` — same sign convention |
| `x ** 2`, `pow(x, 2)` | `x^2` or `x**2` |
| `math.sqrt(x)` | `Sqrt(x)` — exact: `Sqrt(9)` is `3`, `Sqrt(2)` stays `√2` |
| `math.pi`, `math.e` | `Pi`, `e` |
| `math.log(x)`, `math.log10(x)` | `Ln(x)`, `Log(x)`; `Log(x, b)` for base *b* |
| `abs`, `round`, `math.floor`, `math.ceil` | `Abs`, `Round`, `Floor`, `Ceil` (not `Ceiling`) |
| `float(expr)` | `N(expr)`, or `N(expr, digits)` for a precision |
| `10 ** 100` (bigint) | `10^100` — same unbounded integers |
| `complex(2, 3)` | `2 + 3i` |
| `statistics.mean/median` | `Mean`, `Median`, `Variance`, `StandardDeviation` |
| `math.gcd`, `math.factorial` | `GCD`, `LCM`, `n!` |
| *(SymPy territory)* | `Simplify`, `Solve`, `D`, `Integrate`, `Limit`, `Series` are built in |

Exactness is the default, and comparison is tolerant, so the classic
floating-point gotcha does not appear:

```cortex
let exact = 1/3 + 1/6
let approx = N(1/3 + 1/6)
(exact, approx, 0.1 + 0.2 == 0.3)
// ➔ (1/2, 0.5, True)
```

`Round` rounds halves **away from zero**; Python rounds halves to even. This
is the one numeric answer that differs on values you are likely to type:

```cortex
(Round(0.5), Round(2.5), Round(-0.5))
// ➔ (1, 3, -1)
```

(Python gives `0`, `2`, `0`.)

Because values are Compute Engine expressions, arithmetic over a list is
elementwise without NumPy:

```cortex
([1, 2, 3] + 1, [1, 2, 3] * [4, 5, 6], Sum(Map(1..4, k |-> k^2)))
// ➔ ([2,3,4], [4,10,18], 30)
```

## Strings

| Python | Cortex |
|:--|:--|
| `f"x is {x}"` | `"x is \(x)"` — works in any string literal |
| `"a" + "b"` | `StringJoin("a", "b")` — `+` on strings is a **type error** |
| `len(s)` | `Length(Characters(s))` — strings are not collections |
| `s[0]` | `Characters(s)[1]` |
| `s.split()` / `s.split(",")` | `StringSplit(s)` / `StringSplit(s, ",")` |
| `"".join(parts)` | `StringJoin(…)`, or `Fold` over the parts |
| `str(x)` | `String(x)` |
| `"""…"""` | `"""…"""` — multi-line strings, same delimiter |
| `r"raw\string"` | `#"raw\string"#` — extended string literal |

```cortex
let name = "world"
let parts = StringSplit("a b c")
("hello \(name)", StringJoin("a", "b"), Length(Characters(name)), parts[2])
// ➔ ("hello world", "ab", 5, "b")
```

There is no `.upper()`, `.replace()`, `.find()` or `.strip()`: the string
library today is `Characters`, `GraphemeClusters`, `UnicodeScalars`,
`StringSplit`, `StringJoin`, `StringFrom` and `String`. Decompose to a list of
characters or code points, work there, and rebuild.

## Errors

There are no exceptions. A runtime problem becomes an ordinary
`Error(…)` **value** that flows through the computation, so a bad element does
not abort the rest of the work:

```cortex
Map([16, -4, "banana", 81], x |-> Sqrt(x))
// ➔ [4, 2i, NaN, 9]
```

Note also `Sqrt(-4)` → `2i` rather than a `ValueError`: the engine works over
the complex numbers. Malformed *source* is different — it produces
**diagnostics** with source positions, reported separately from the value.

## Familiar

These transfer straight across — no translation needed:

```cortex
let xs = [10, 20, 30]
(xs[-1], 20 in xs, 1 < 2 < 3, 2**10, -7 % 3)
// ➔ (30, True, True, 1024, 2)
```

- Negative indices count from the end; `in` tests membership.
- Chained comparisons (`1 < x <= 4`) mean the conjunction, as in Python.
- `**` is an accepted alias of `^`, right-associative (`2^3^2` is `512`).
- `%` is the remainder with Python's sign convention.
- Integers are arbitrary precision, with no `int`/`long` distinction.
- `true`/`false` are accepted spellings of `True`/`False`.
- Closures capture lexically, and functions are first-class values.
- `;` separates statements on one line, exactly as in Python.

## Traps

Reflexes that produce a *wrong answer* rather than an error. The parser emits
a **warning diagnostic** for the first three — visible on stderr from the CLI,
and in the `diagnostics` array when embedding — but the program still runs and
still returns a plausible-looking value.

| You write | What actually happens | Write instead |
|:--|:--|:--|
| `7 // 2` | `//` starts a comment, so the statement is just `7` | `Floor(7 / 2)` |
| `xs[0]` | Silently `NaN` — indexing is 1-based | `xs[1]` |
| `f(a = 1)` as a keyword argument | There are no keyword arguments; inside an expression `=` is `Equal`, so this passes the boolean `a == 1` | pass positionally |
| `d["missing"]` | An absence value, not a `KeyError` (`NaN` for a numeric field, otherwise `Missing`) | `Coalesce(d["missing"], fallback)` or test with `IsMissing` |
| `xs[1:3]` | Python's half-open slice; `xs[2..3]` is 1-based and inclusive | check both ends |
| `x^1/2` | `(x^1)/2` — `^` binds tighter than `/` | `Sqrt(x)` or `x^(1/2)` |
| `x = 5` inside an expression | Compares, rather than assigning — only a whole statement assigns | `:=` to assign in place, `==` to be explicit |
| `print(x)` | Inert, nothing is printed | the program's value is its last statement |
| `Round(2.5)` | `3` (half away from zero), not Python's `2` | *(intentional)* |
| `3!^2` | Diagnostic — the lexer reads `!^` as one token | `3! ^ 2` |
| `a +b` | Diagnostic — an infix operator needs spaces on both sides or neither | `a + b` or `a+b` |
| `"\(xs)"` with a list `xs` | Broadcasts into a *list of strings* | interpolate scalars only |
| `x && y` on fresh symbols | Types those symbols `boolean` for the engine's lifetime | use distinct names for boolean work |

One more, specific to a symbolic language: a `Take(xs, 3)` (or any lazy
operator) stored inside a **tuple** stays unevaluated, because a tuple does
not materialize its operands. Aggregate or index where you stand if you need
the work done now.

## Next

<ReadMore path="/cortex/examples/">
**~70 complete programs**, all verified — iteration, number theory, calculus,
linear algebra, strings, and randomness.
</ReadMore>

<ReadMore path="/cortex/for-agents/">
The **condensed language card** — the same material at reference density, for
AI agents and for skimming.
</ReadMore>

<ReadMore path="/cortex/control-flow/">
**Control flow** in full — `match` patterns, guards, pins, destructuring,
blocks and loops.
</ReadMore>
