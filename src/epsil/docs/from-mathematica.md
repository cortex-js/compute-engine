---
title: Epsil for Mathematica Users
sidebar_label: From Mathematica
slug: /epsil/from-mathematica/
description: "A translation guide from the Wolfram Language to Epsil: idiom-by-idiom mappings for expressions, lists, iterators, pattern matching and calculus, plus the surface forms that look alike but differ."
hide_title: true
date: Last Modified
---
# Epsil for Mathematica Users

A working translation guide for anyone coming from the Wolfram Language. Every
Epsil example on this page is executed by the documentation test suite and
its `// ➔` output verified.

**What carries over.** Almost all of the mental model. Values are symbolic
expressions; evaluation is exact unless you ask for a number; capitalized
names are the library and lowercase names are yours; `Simplify`, `Solve`, `D`,
`Integrate`, `Limit`, `Series`, `Factor`, `Expand`, `N` and the linear-algebra
operators all keep their names; `{k, 1, n}` iterator triples work in `Sum`,
`Product`, `Integrate`, `D` and `Table`; `Range(5)` starts at 1; indexing is
1-based and `-1` is the last element; arithmetic threads over lists the way a
`Listable` function does.

**What to unlearn.** Four things:

1. **Function application uses parentheses**: `f(x)`, not `f[x]`. Square
   brackets are indexing (Wolfram's `[[…]]`).
2. **`{…}` is a set, not a list.** An Epsil list is `[1, 2, 3]`. The braces
   survive in iterator triples, where they read positionally, but a bare
   `{1, 2, 2}` is the *set* `{1, 2}`.
3. **`=` assigns only as a whole statement; inside an expression it is `Equal`.** `->` is a key/value pair. `:=` always assigns and `==` always compares
   (as in Wolfram), but replacement rules must be written `Rule(x, 3)`.
4. **There is no `%`**, no `Out[]`, and no notebook history. `%` is the
   remainder operator.

## Expressions and Evaluation

| Wolfram | Epsil |
|:--|:--|
| `f[x]`, `Sin[x]` | `f(x)`, `Sin(x)` |
| `x = 5` | `let x = 5` |
| `f[x_] := x^2` | `f(x) = x^2` |
| `f = Function[x, x^2]` | `f = x \|-> x^2` |
| `#^2 &` | `x \|-> x^2` — no slot/`&` syntax |
| `expr /. x -> 3` | `ReplaceAll(expr, Rule(x, 3))` |
| `a == b`, `SameQ[a, b]` | `a == b`, `a === b` — see below |
| `expr // N` | `expr \|> N` (or `~>`) |
| `N[expr]`, `N[expr, 25]` | `N(expr)`, `N(expr, 25)` |
| `Hold[expr]` | `HoldValues(expr)` — evaluate with assigned symbols kept symbolic |
| `Print[x]` | *(no printing)* — the program's value is its **last statement** |
| `%`, `Out[3]` | *(no history)* — bind with `let` |
| `(* comment *)` | `// comment` or `/* comment */` |
| `expr;` to suppress output | `;` is a statement separator, nothing is suppressed |

```epsil
f(x) = x^2 + 1
(f(3), D(f(x), x), Integrate(f(x), {x, 0, 1}))
// ➔ (10, 2x, 4/3)
```

Only the value of the **last** statement is returned; an earlier statement
that evaluates to an error value also raises a diagnostic, so nothing vanishes
silently.

### `==` vs `===` (Wolfram's `SameQ`)

`==` is the semantic comparison: it evaluates, compares within tolerance, and
may stay an unresolved *condition* (`x == y` is what you hand to `Solve`).
`===` is `SameQ`: structural identity, no tolerance, and **total** — it always
answers `True` or `False`.

```epsil
(Sqrt(2) == 1.4142135623730951, Sqrt(2) === 1.4142135623730951, x === y, 1 === 1.0)
// ➔ (True, False, False, True)
```

One caveat for Wolfram users: `SameQ[1, 1.]` is `False` there, because `1` and
`1.` are different *kinds* of number. In Epsil `1 === 1.0` is `True` — the
lexer folds `1.0` to the integer literal `1`, and `===` compares number leaves
by exact value, so `0.5 === 1/2` is `True` too.

## Lists and Parts

| Wolfram | Epsil |
|:--|:--|
| `{1, 2, 3}` (list) | `[1, 2, 3]` — braces make a **set** |
| `xs[[i]]` | `xs[i]` — 1-based, as in Wolfram |
| `xs[[-1]]`, `First`, `Last`, `Rest` | `xs[-1]`, `First(xs)`, `Last(xs)`, `Rest(xs)` |
| `xs[[2 ;; 4]]` | `xs[2..4]` |
| `m[[i, j]]` | `m[i, j]` (or `m[i][j]`) |
| `Range[5]`, `Range[2, 10, 2]` | `Range(5)` or `1..5`; `Range(2, 10, 2)` |
| `Length`, `Sort`, `Reverse`, `Flatten` | same names |
| `Total[xs]` | `Sum(xs)` |
| `Select[xs, f]` | `Filter(xs, f)` |
| `Count[xs, v]`, `Count[xs, f]` | `Count(xs, v)`, `Count(xs, f)` — `Count(xs)` is the length |
| `Map[f, xs]`, `f /@ xs` | `Map(xs, f)` — collection **first** |
| `Fold[f, init, xs]` | `Fold(f, init, xs)` |
| `Apply[f, {a, b}]`, `f @@ t` | `Apply(f, (a, b))`, or spread: `f(...t)` |
| `Position[xs, v]` | `IndexOf(xs, v)` |
| `Append[xs, v]`, `Join` | `Append(xs, v)`, `Join(xs, ys)` |
| `Tally`, `Partition` | same names (`Tally` returns a `(values, counts)` pair) |
| `<\|"a" -> 1\|>` (association) | `{"a" -> 1}`; read with `d["a"]` or `d.a`, enumerate with `Keys`/`Values` |
| `Union`, `Intersection` | same names, returning a set |

```epsil
let xs = [3, 1, 4, 1, 5]
(xs[1], xs[-1], xs[2..4], Length(xs), Sort(xs))
// ➔ (3, 5, [1,4,1], 5, [1,1,3,4,5])
```

`Count` covers all three Wolfram spellings — the plain length, a value to
match, and a predicate:

```epsil
let xs = [3, 1, 4, 1, 5, 1]
(Count(xs), Count(xs, 1), Count(xs, k |-> k > 2))
// ➔ (6, 3, 3)
```

Lists and sets are genuinely different types, so the brace/bracket distinction
is not cosmetic:

```epsil
(Type({1, 2, 3}), Type([1, 2, 3]))
// ➔ ("set<finite_integer>", "vector<finite_integer^3>")
```

### Threading over lists

Arithmetic and the elementary functions thread over lists, so a `Listable`
habit transfers directly. Matrices multiply as matrices:

```epsil
([1, 2, 3] + 1, [1, 2, 3] * [4, 5, 6], Sin([0, Pi]))
// ➔ ([2,3,4], [4,10,18], [0,0])
```

```epsil
let A = [[2, 1], [1, 3]]
(Determinant(A), Inverse(A), A * [1, 1])
// ➔ (5, [[3/5,-1/5],[-1/5,2/5]], [3,4])
```

## Iterators and Table

Iterator triples in braces work exactly as in Wolfram — `Sum`, `Product`,
`Integrate`, `D` and `Table` all read `{var, lo, hi}` (and `{var, lo, hi,
step}`) positionally:

```epsil
let squares = Table(k^2, {k, 1, 5})
(Sum(squares), Sum(1/k^2, {k, 1, Infinity}), Product(k, {k, 1, 5}))
// ➔ (55, 1/6 * pi^2, 120)
```

`Sum`, `Product`, `Integrate` and `Table` all accept the tuple spelling
`(k, 1, 5)` as well. `D(expr, {x, 2})` takes a second derivative.

```epsil
Sum(Table(k^2, (k, 1, 5)))
// ➔ 55
```

`Table` is a lazy generator, so the value above is materialized by `Sum`. When
you want an ordinary list, index it, aggregate it, or build it with `Map`:

```epsil
let g = x |-> x^2 + 1
(g(3), Sum(Map(1..4, g)))
// ➔ (10, 34)
```

## Control Flow and Pattern Matching

| Wolfram | Epsil |
|:--|:--|
| `If[c, a, b]` | `a if c else b`, or `if c { a } else { b }` — an expression |
| `Which[c1, a, c2, b, True, z]` | `if c1 { a } else if c2 { b } else { z }` |
| `Switch[x, 0, "zero", _, "other"]` | `match x { 0 => "zero"; _ => "other" }` |
| `Cases[xs, patt]` | `Filter` with a predicate, or `Map` over a `match` |
| `Do[body, {k, 1, n}]` | `for k in 1..n { body }` |
| `While[c, body]` | `while c { body }` |
| `Module[{t}, body]` | `do { let t = …; body }`, or a `function` block |
| `With[{t = v}, body]` | `do { const t = v; body }` |
| `Block[{x}, body]` | *(no dynamic scoping)* — Epsil is lexically scoped |

`match` replaces the whole `Switch`/`Which`/`Cases` family. It is structural
and total: it always selects a case, and a bare identifier in pattern position
**binds** rather than compares. Guards use `if`, and `== expr` pins a value.

```epsil
classify(z) = match z {
  0 => "zero"
  n if n > 0 => "positive"
  _ => "negative"
}
Map([-2, 0, 5], classify)
// ➔ ["negative", "zero", "positive"]
```

Because a pattern is parsed as an ordinary expression, matching on operator
structure comes for free — a case pattern `a + b` destructures an `Add` and
captures its operands, the Wolfram `Plus[a_, b_]` idiom. Blank patterns are
spelled differently: `_` is the wildcard, `name` is a named capture (Wolfram's
`name_`), `name: type` adds a type guard (`name_Integer`), and `...rest`
captures the remainder of a list (`___`). See
[Control Flow](/epsil/control-flow/#match) for the full pattern grammar.

Scoping constructs are blocks:

```epsil
function area(r) {
  let c = Pi
  c * r^2
}
(area(2), area(3))
// ➔ (4pi, 9pi)
```

## Symbolic Mathematics

This is the part that needs the least translation:

| Wolfram | Epsil |
|:--|:--|
| `Simplify`, `Expand`, `Factor` | same names |
| `Solve[x^2 == 4, x]` | `Solve(x^2 == 4, x)` |
| `Solve[{e1, e2}, {x, y}]` | `Solve([e1, e2], [x, y])` — lists in brackets |
| `D[f, x]`, `D[f, {x, 2}]` | `D(f, x)`, `D(f, {x, 2})` |
| `Integrate[f, x]`, `Integrate[f, {x, a, b}]` | same, with parentheses |
| `Limit[f, x -> 0]` | `Limit(f, x, 0)` |
| `Series[f, {x, 0, n}]` | `Series(f, x, 0)` — the tail is a `BigO` term |
| `Det`, `Inverse`, `Transpose`, `Eigenvalues` | `Determinant`, `Inverse`, `Transpose`, `Eigenvalues` |
| `Dot`, `Cross`, `LinearSolve` | same names |
| `Pi`, `Infinity`, `I`, `E` | `Pi`, `Infinity`, **`i`**, **`e`** — lowercase |
| `PrimeQ`, `NextPrime`, `FactorInteger`, `Divisors` | `IsPrime`, `NextPrime`, `FactorInteger`, `Divisors` |
| `Binomial`, `GCD`, `LCM`, `n!` | same |

```epsil
(Solve(x^2 - 5x + 6 == 0, x), Simplify((x^2 - 1)/(x - 1)), Factor(x^2 - 4))
// ➔ ([3,2], x + 1, (x - 2) * (x + 2))
```

```epsil
(Limit((1 + 1/n)^n, n, Infinity), Series(Cos(x), x, 0))
// ➔ (e, 1 - 1/2 * x^2 + 1/24 * x^4 + BigO(x^6))
```

`N` takes an optional precision, and the engine works to arbitrary precision:

```epsil
N(Pi, 25)
// ➔ 3.141592653589793238462643
```

## Traps

Surface forms that look like Wolfram but behave differently.

| You write | What actually happens | Write instead |
|:--|:--|:--|
| `f[x]` | `f` *indexed* at `x` — an `incompatible-type` error value, not a call | `f(x)` |
| `{1, 2, 3}` for a list | A **set**: unordered, deduplicated, not indexable by position | `[1, 2, 3]` |
| `E`, `I` | Ordinary undeclared symbols — they stay symbolic, silently | `e`, `i` |
| `expr /. x -> 3` | `->` builds a `KeyValuePair`, not a `Rule` | `ReplaceAll(expr, Rule(x, 3))` |
| `%` for the last result | `%` is the `Mod` operator | bind results with `let` |
| `x = 4` inside `Solve` | Works as expected — inside an expression `=` is `Equal`, so `Solve(x^2 = 4, x)` is the equation | *(nothing to change)* |
| `expr;` to suppress | `;` only separates statements | *(nothing to suppress)* |
| `Total`, `Select`, `Cases`, `MemberQ`, `Accumulate`, `Nest` | Unknown names: the call stays **symbolic and inert**, with a did-you-mean warning naming the Epsil operator | `Sum`, `Filter`, `Filter`, `Contains(xs, v)`, `Scan`, `Iterate` |
| `Ceiling`, `Quotient`, `IntegerPart` | Inert (with a did-you-mean warning) | `Ceil`, `Floor(a/b)`, `Floor` |
| `StringLength`, `ToUpperCase` | Inert — the string library is small | `Length(Characters(s))`; decompose and rebuild |
| `RandomReal[]`, `RandomInteger[n]` | Inert (with a did-you-mean warning) | `Random()`, `Random(1..n)` |
| `SameQ[1, 1.]` | `1 === 1.0` is `True` — the lexer folds `1.0` to `1` | *(nothing — but don't read `===` as type-aware)* |
| `3!^2` | Diagnostic — the lexer reads `!^` as one token | `3! ^ 2` |
| `a +b` | Diagnostic — an infix operator needs spaces on both sides or neither | `a + b` or `a+b` |

The rows about inert names deserve emphasis: **an unknown capitalized name is
not an error.** Epsil leaves the call symbolic (with a did-you-mean warning
when a close library name exists), exactly the way Wolfram leaves `Foo[1]`
unevaluated. A program that calls `Total(xs)` therefore returns the unevaluated
`Total([…])` rather than a number — when a result looks unfinished, check for
an inert head.

The most-reached-for Wolfram names are curated into that warning, so
`Total(xs)` reports `did you mean Sum` and `Select(xs, f)` reports
`did you mean Filter`. The suggestion is only a pointer to the right
neighborhood — it is **not** an alias, and the call shape may differ
(`Accumulate[xs]` becomes `Scan(xs, Add)`, with an explicit combining
function). `MemberQ[xs, v]` maps directly to `Contains(xs, v)`, same
argument order.

Also worth knowing: lazy collection operators (`Range`, `Map`, `Filter`,
`Take`, `Table`) enumerate only when materialized, and a tuple does **not**
materialize its operands — `(Table(k, {k, 1, 3}), 5)` keeps the unevaluated
`Tabulate(…)`. Aggregate or index where you stand.

## Next

<ReadMore path="/epsil/examples/">
**~70 complete programs**, all verified — number theory, calculus, linear
algebra, units, strings, and reproducible randomness.
</ReadMore>

<ReadMore path="/epsil/control-flow/">
**Control flow** in full — the complete `match` pattern grammar, blocks,
loops, and function forms.
</ReadMore>

<ReadMore path="/epsil/for-agents/">
The **condensed language card** — the same material at reference density.
</ReadMore>
