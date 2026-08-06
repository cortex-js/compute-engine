---
title: Cortex for AI Agents
sidebar_label: For AI Agents
slug: /cortex/for-agents/
description: "A condensed, machine-verified reference for AI agents writing Cortex: core semantics, syntax, and a table of the ways Cortex differs from Python and JavaScript reflexes."
hide_title: true
date: Last Modified
---
# Cortex for AI Agents

A condensed reference for language models and coding agents writing Cortex.
Every code fence on this page is executed by the test suite and its `// ➔`
output verified — the examples cannot drift from the implementation. Cortex is
**experimental**: syntax and semantics may change between releases.

## What Cortex Is

Cortex is a programming language for scientific computing built on the Compute
Engine. It is **symbolic and exact by default**: `1/3` is the rational one
third, not `0.333…`, and `Ln(2)` or `Sqrt(2)` stay symbolic. Ask for a decimal
explicitly with `N(expr)`. A program is a sequence of statements (separated by
newlines or `;`); its result is the **value of the last statement**. There is
no `print` — produce the value you want as the final statement. Runtime
problems (a `const` reassignment, a type mismatch) become ordinary
`Error(...)` **values**, not thrown exceptions; malformed source produces
**diagnostics** with source locations.

**Run it**: `npx cortex file.cx`, `npx cortex --eval 'expr'`, stdin, or a REPL
(`npx cortex`). Diagnostics go to stderr; exit code 0 = success, 1 = error.
**Validate without evaluating**: `npx cortex check file.cx --json` emits
structured diagnostics (positions, fix-its). **Look up the library**:
`npx cortex doc Mean`, or search by concept — `npx cortex doc "standard
deviation"`. Add `--diagnostics json` to a run for machine-readable runtime
diagnostics. Embed via `executeCortex(ce, source)` from
`@cortex-js/compute-engine/cortex`. See [CLI](/cortex/cli/).

**Naming convention**: `Capitalized` names are library operators (`Sin`,
`Map`, `Simplify`); `lowercase` names are your variables and functions.
Calling an unknown function is not an error — the call stays symbolic (a
warning diagnostic with a did-you-mean suggestion fires when a close library
name exists, e.g. `len` → `Length`).

## Core Syntax

```cortex
let x = 5                 // mutable declaration
const tau = 6.28          // immutable; reassigning yields an Error value
x = x + 3                 // assignment: a bare `=` assigns only as a STATEMENT
f(x) = x^2                // function definition, math style
square = x |-> x^2        // anonymous function ("|->" is the lambda arrow)
function g(n) {           // function definition, block style
  let t = n + 1           // blocks are lexically scoped
  t * 2                   // a block's value is its last expression
}
let parity = if x % 2 == 0 { "even" } else { "odd" }  // if is an EXPRESSION
g(x) + f(2)
// ➔ 22
```

- **Comments**: `// line` and `/* block */`. NOT `#` (that starts a pragma).
- **Statements**: one per line, or separated by `;`. Two expressions on one
  line with no separator is a diagnostic. A line ending in an infix operator
  continues onto the next line.
- **Whitespace rule**: an infix operator has spaces on both sides or neither
  (`a + b` or `a+b`; `a +b` is a diagnostic). Prefix `-x`/`!x` and postfix
  `n!` must touch their operand.
- **Types** (optional) use the Compute Engine type language:
  `let n: integer = 4`, `f(x: real) -> real = x^2`. Parameter types are
  enforced at call time.
- **Collections**: list `[1, 2, 3]`, set `{1, 2, 3}`, tuple `(1, 2)`,
  dictionary `{one -> 1, two -> 2}`, empty dictionary `{->}` (`{}` is the
  empty set). Access dictionaries with `d["key"]`; identifier-shaped keys also
  have the shorthand `d.key`. Tuples index like lists (`p[1]` is the first
  component); a matrix (list of lists)
  indexes as `m[2, 1]` or `m[2][1]`.
- **Spread**: in a call argument list, `...t` splices a **tuple**'s elements
  in as positional arguments (`f(...p)`, `Max(...t)`, `g(1, ...p, ...q)`).
  Tuples only — spreading a list is an `incompatible-type` error — and `...`
  is valid nowhere else.
- **Destructuring**: `let (q, r) = divmod(17, 5)` binds a tuple's components
  (`const` makes them constants; `_` skips a position; patterns nest). Tuples
  only, ≥ 2 elements, initializer required; a shape mismatch is an Error
  value. For conditional destructuring use `match`.
- **Block in expression position**: `do { … }` (a bare `{ … }` in expression
  position is always a set/dictionary literal).
- **LaTeX islands**: `$\frac{1}{2}$` splices parsed LaTeX into the expression
  (available in the CLI and any host that injects a LaTeX parser).

**Operator precedence**, loosest → tightest: `:=` · `|->` · `??` (coalesce) ·
`|>` (pipe) · `->` (key-value) · `||` · `&&` · comparisons
`== != < <= > >= === in !in is` (chainable: `1 < 2 < 3`) · `..` (range) ·
`+ -` · `* / %` · unary `- !` · `^`/`**` (right-associative) · postfix `!`.
Calls `f(x)` and indexing `xs[i]` bind tightest of all. A bare `=` has no
fixed tier: it binds like `:=` when it assigns and like `==` when it compares.

## If You Know Python or JavaScript

Cortex deliberately diverges from these reflexes. **Wrong-by-instinct → what
actually happens → write instead:**

| Reflex | What happens in Cortex | Write instead |
|:--|:--|:--|
| `xs[0]` for first element | **Silently** yields `NaN` — indexing is **1-based** | `xs[1]`; negative indices work: `xs[-1]` is the last element |
| `7 // 2` floor division | **Silent wrong value**: `//` starts a comment, so this is just `7` | `Floor(7 / 2)` |
| `7 / 2` integer division | Exact rational `7/2`, not `3` or `3.5` | `Floor(7 / 2)` for `3`; `N(7 / 2)` for `3.5` |
| `range(1, 5)` excludes end | Inert call + did-you-mean; `Range(1, 5)` **includes** 5: `[1,2,3,4,5]` | `Range(1, n)` or `1..n` for 1…n inclusive |
| `x = 5` at top level | Assigns — `=` assigns only as a whole statement with a name on the left | `x == 5` for the equation |
| `# comment` | Diagnostic (`#` introduces pragmas) | `// comment` or `/* … */` |
| `def f(x):` / `(x) => …` / `lambda x: …` | Parse diagnostics | `f(x) = expr`, `x \|-> expr`, or `function f(x) { … }` |
| `cond ? a : b` | Parse diagnostic | `if cond { a } else { b }` — `if` is an expression |
| `elif` | Parse diagnostic | `else if` |
| `return` | Reserved word, **not implemented** | A block's value is its last expression |
| `break` / `continue` | Work as expected inside a `while`/`for` body; the loop context resets at every function and lambda boundary | *(nothing to change)* |
| `print(x)` | Inert unknown call; nothing prints | The program's value is its **last statement** |
| `len(xs)` | Inert + did-you-mean | `Length(xs)` |
| `s[i]` / `len(s)` on a string | Error value / inert — strings are **not** collections | `Characters(s)[i]`, `Length(Characters(s))` |
| `"a" + "b"` | Error values inside an `Add` | `"\(a) and \(b)"` interpolation, or `StringJoin(a, b)` |
| `xs[2] = 9` | Runtime error value — no element assignment; collections are immutable values | Rebuild: `Map`, `Join(xs, [v])`, `Append(xs, v)` |
| `and` / `or` / `not` | Parse diagnostics (reserved words) | `&&`, `\|\|`, `!` |
| `x**0.5` habits: `x^1/2` | Parses as `(x^1)/2` — precedence, not a root | `Sqrt(x)` or `x^(1/2)` |
| `math.floor`, `np.mean` | No modules/namespaces | Everything is global: `Floor`, `Mean`, `Sin`, … |
| `for` loop building a value | Loops are for **effect**; their value is `Nothing` | Accumulate into a `let`, or use `Map`/`Filter`/`Reduce` |
| f-strings / template literals | Backtick is the verbatim-symbol quote; `${}` invalid | `"x is \(x)"` works in any string |

Comfortable habits that **do** transfer: `**` is an accepted alias of `^`
(both right-associative, `2^3^2` → `512`); `%` is `Mod` with the sign
convention of Python (`-7 % 3` → `2`); `xs[-1]` is the last element; `0.1 +
0.2 == 0.3` is `True` (decimal arithmetic); chained comparisons `1 < 2 < 3`
work; `2 in [1, 2, 3]` works; lowercase `true`/`false` are accepted
(canonically `True`/`False`).

## Verified Idioms

Exactness and numeric approximation:

```cortex
let exact = 1/3 + 1/6      // stays the exact rational 1/2
let sym = Sqrt(2) * Sqrt(2) // symbolic radicals reduce exactly
"\(exact), \(sym), \(N(Pi, 10))"
// ➔ "1/2, 2, 3.141592654"
```

Functions, recursion (self-reference works in a one-step definition, with
any number of recursive calls — `fib(n-1) + fib(n-2)` is fine), and closures:

```cortex
fact(n) = if n <= 1 { 1 } else { n * fact(n - 1) }
makeAdder(k) = x |-> x + k     // closures capture lexically
let add10 = makeAdder(10)
add10(fact(5))
// ➔ 130
```

Collections pipeline — `Map`/`Filter`/`Reduce` for value-producing iteration,
`|>` to chain; `1..n` is an inclusive range:

```cortex
1..10 |> Filter(_, k |-> k % 2 == 0) |> Map(_, k |-> k^2)
// ➔ [4, 16, 36, 64, 100]
```

```cortex
Reduce([1, 2, 3, 4], (acc, x) |-> acc + x, 0) + Sum(1..100)
// ➔ 5060
```

Loops are for effect — accumulate into a variable declared outside:

```cortex
let a = 1071
let b = 462
while b != 0 {
  let t = a % b
  a = b
  b = t
}
a
// ➔ 21
```

Building a list in a loop (each `[k]` literal snapshots the current value):

```cortex
let xs = []
for k in 1..3 { xs = Join(xs, [k * k]) }
xs
// ➔ [1, 4, 9]
```

Structural `match` (an expression; `_` is the wildcard; a bare name **binds**
— use `== expr` to compare against a value):

```cortex
classify(n) = match n {
  0 => "zero"
  k if k > 0 => "positive"
  _ => "negative"
}
classify(-5)
// ➔ "negative"
```

Symbolic computation:

```cortex
let poly = Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
let roots = Solve(x^2 + x - 6 == 0, x)
let deriv = D(x^3 + x, x)
let area = Integrate(Sin(x), (x, 0, Pi))
(poly, roots, deriv, area)
// ➔ (4x^3 + 2x^2 + 3, [2,-3], 3x^2 + 1, 2)
```

Lists, slices, and common operators (all indexing is 1-based):

```cortex
let xs = [10, 20, 30, 40]
(xs[1..2], First(xs), Last(xs), Sort([3, 1, 2]), IndexOf(xs, 30))
// ➔ ([10,20], 10, 40, [1,2,3], 3)
```

Dictionaries (string keys; dot access is shorthand for identifier-shaped
keys):

```cortex
let d = {one -> 1, two -> 2}
(d.two, d["two"], IsMissing(d.missing), Coalesce(d.missing, 0))
// ➔ (2, 2, True, 0)
```

An absent numeric field evaluates to `NaN`; an absent nonnumeric field remains
`Missing`. `IsMissing` recognizes both forms.

## Library Quick Roster

Verified operator names, so you don't have to guess (search for more with
`cortex doc <keywords>`):

- **Numbers**: `Abs`, `Floor`, `Ceil` (not `Ceiling`), `Round`, `Sqrt`,
  `Max`, `Min` (each takes a list or varargs), `Mod`, `GCD`, `LCM`,
  `IsPrime`, `Random(Range(a, b))`.
- **Lists**: `Length`, `First`, `Last`, `Rest`, `Take`, `Drop`, `Reverse`,
  `Sort` (optional comparator — see below), `IndexOf`, `Join`, `Append`,
  `Sum`, `Mean`, `StandardDeviation` (sample, n−1), `Map`, `Filter`,
  `Count(xs)` / `Count(xs, v)` / `Count(xs, pred)`,
  `Reduce(list, f, init)`, `Range(a, b)` inclusive, `Range(a, b, step)`.
- **Strings**: `Characters`, `StringJoin`, `StringSplit(s)` (splits on
  whitespace by default), `String(x)`.
- **Dictionaries**: `Keys`, `Values`.
- **Absence**: `Missing` preserves a missing position; `Nothing` is omitted
  from arguments and collections; `IsMissing`, `Coalesce`.
- **Symbolic**: `Simplify`, `HoldValues(body)` (evaluate `body` with its
  assigned symbols kept symbolic), `Solve(eq == v, x)`, `D(expr, x)`,
  `Derivative(f)`, `Integrate`, `N`, `Type`, `IsError(x)` (true for an error
  value, or an expression carrying one).

Caution: `Head` and `Tail` exist but are **structural** operators
(`Head([1,2,3])` is the *operator name* `"List"`, not the first element) —
for elements use `First`/`Rest`.

```cortex
Sort([3, 1, 4, 1, 5], (a, b) |-> a > b)
// ➔ [5,4,3,1,1]
```

## Watch Out For

- **Laziness**: `Range`, `Map`, `Filter`, `Take`, `Drop`, `Join` are
  generators — they enumerate when materialized (indexed, aggregated, or
  iterated; e.g. a `Take(xs, 3)` stored inside a tuple stays an unevaluated
  `Take(...)`), and a deferred mapping function reads variables **at
  materialization time**. Collection *literals* snapshot their element values
  immediately. To force work now, aggregate or index where you stand.
- **Output is the engine's textual form**: strings and booleans print
  *quoted* (`"True"`, `"xetroc"`) — that quoted `"True"` is a boolean, not a
  string. Derived collections (`Range`, `Map`/`Filter` results, loop-built
  lists) preview-elide above 10 elements (`[1,2,3,4,5,...,]`); the value is
  complete — the CLI's `--json` output materializes the full elements (up to
  10,000). Literals print in full.
- **Binder variables stay symbolic**: `D(expr, x)` and `Integrate(expr, x)`
  treat `x` symbolically even if `x` has an assigned value; the *result*
  then evaluates with the value. So `let x = 2` followed by
  `N(D(x^3 + x, x))` is `13` — the derivative is taken first.
- **Interpolating a collection broadcasts**: `"\(expr)"` with a list-valued
  `expr` maps the string over the elements, yielding a *list of strings*
  (`"n = \([1, 2])"` → `["n = 1", "n = 2"]`), not one string containing the
  list. Interpolate scalars only.
- **Only the last statement's value is returned.** An error value in an
  earlier statement also emits a `runtime-error` diagnostic so it can't vanish
  silently.
- **Boolean inference is sticky**: using a bare undeclared symbol as a
  boolean operand (`&&`/`||`/`!`) types it `boolean` for the engine's
  lifetime; a later numeric use of the same symbol errors.
- **`3!^2` is a diagnostic** — the lexer reads `!^` as one operator token.
  Space it: `3! ^ 2`.
- **`match` binds bare names**: `match x { Pi => … }` does not compare with π
  — it binds a new variable named `Pi`. Pin values with `==`:
  `match x { == Pi => … }`.

For the full reference start at [Cortex](/cortex/), the complete grammar in
[Syntax](/cortex/syntax/), and ~70 more verified programs in
[Examples](/cortex/examples/).
