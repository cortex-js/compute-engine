---
title: Epsil for AI Agents
sidebar_label: For AI Agents
slug: /epsil/for-agents/
description: "A condensed, machine-verified reference for AI agents writing Epsil: core semantics, syntax, and a table of the ways Epsil differs from Python and JavaScript reflexes."
hide_title: true
date: Last Modified
---
# Epsil for AI Agents

A condensed reference for language models and coding agents writing Epsil.
Every code fence on this page is executed by the test suite and its `// ➔`
output verified — the examples cannot drift from the implementation. Epsil is
**experimental**: syntax and semantics may change between releases.

## What Epsil Is

Epsil is a programming language for scientific computing built on the Compute
Engine. It is **symbolic and exact by default**: `1/3` is the rational one
third, not `0.333…`, and `ln(2)` or `sqrt(2)` stay symbolic. Ask for a decimal
explicitly with `N(expr)`. A program is a sequence of statements (separated by
newlines or `;`); its result is the **value of the last statement**. There is
no `print` — produce the value you want as the final statement. Runtime
problems (a `const` reassignment, a type mismatch) become ordinary
`Error(...)` **values**, not thrown exceptions; malformed source produces
**diagnostics** with source locations.

**Run it**: `npx epsil file.epsil`, `npx epsil --eval 'expr'`, stdin, or a REPL
(`npx epsil`). Diagnostics go to stderr; exit code 0 = success, 1 = error.
**Validate without evaluating**: `npx epsil check file.epsil --json` emits
structured diagnostics (positions, fix-its). **Look up the library**:
`npx epsil doc Mean`, or search by concept — `npx epsil doc "standard
deviation"`. Add `--diagnostics json` to a run for machine-readable runtime
diagnostics. Embed via `executeEpsil(ce, source)` from
`@cortex-js/compute-engine/epsil`. See [CLI](/epsil/cli/).

**Naming convention**: library operators are written in lowercase (`sin`,
`map`, `simplify`, `pi`) and also answer to their MathJSON names (`Sin`,
`map`, `simplify`, `pi`). Your variables and functions are lowercase too and
shadow a library name by scope (`let sum = 0` makes `sum` a variable).
Operators with their own syntax have no lowercase spelling (`Add` is `+`,
`If` is `if`, `List` is `[…]`). Calling an unknown function is not an
error — the call stays symbolic (a warning diagnostic with a did-you-mean
suggestion fires when a close library name exists, e.g. `len` → `length`).

## Core Syntax

```epsil
let x = 5                 // mutable declaration
const tau = 6.28          // immutable; reassigning yields an Error value
x = x + 3                 // assignment: a bare `=` assigns only as a STATEMENT
f(x) = x^2                // function definition, math style
square = x => x^2        // anonymous function ("=>" is the lambda arrow)
cube : (x: number) -> number = x^3   // a named function-type annotation binds x
function g(n) {           // function definition, block style
  let t = n + 1           // blocks are lexically scoped
  t * 2                   // a block's value is its last expression
}
hold h(e) = head(e)       // hold: arguments arrive UNEVALUATED (h(x + 1) ➔ Add)
hold mySum(body, bind i, n) = sum(body, (i, 1, n))  // bind: a bound-variable slot; mySum(k^2, k, 3) ➔ 14
function op(a, b) commutative associative -> number { a + b }  // algebraic words in the specifier slot
/// A doc comment right before a definition is its description (About, hover)
let parity = "even" if x % 2 == 0 else "odd"  // conditional expression; if is also an expression: if c { a } else { b }
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
  in as positional arguments (`f(...p)`, `max(...t)`, `g(1, ...p, ...q)`).
  Tuples only — spreading a list is an `incompatible-type` error — and `...`
  is valid nowhere else.
- **Destructuring**: `let (q, r) = divmod(17, 5)` binds a tuple's components
  (`const` makes them constants; `_` skips a position; patterns nest). Tuples
  only, ≥ 2 elements, initializer required; a shape mismatch is an Error
  value. For conditional destructuring use `match`. The same pattern assigns
  to EXISTING bindings with `:=`, evaluating the right side once before it
  writes anything, so `(a, b) := (b, a)` swaps. It must be `:=` — a
  statement-leading `(a, b) = …` is a comparison, and is diagnosed.
- **Block in expression position**: `do { … }` (a bare `{ … }` in expression
  position is always a set/dictionary literal).
- **LaTeX islands**: `$\frac{1}{2}$` splices parsed LaTeX into the expression
  (available in the CLI and any host that injects a LaTeX parser).

**Operator precedence**, loosest → tightest: `:=` · `=>` · `??` (coalesce) ·
`|>` (pipe) · `->` (key-value) · `a if c else b` (conditional) · `||` · `&&` ·
comparisons
`== != < <= > >= === in !in is` (chainable: `1 < 2 < 3`) · `..` (range) ·
`+ -` · `* / %` · unary `- !` · `^`/`**` (right-associative) · postfix `!`.
Calls `f(x)` and indexing `xs[i]` bind tightest of all. A bare `=` has no
fixed tier: it binds like `:=` when it assigns and like `==` when it compares.

## If You Know Python or JavaScript

Epsil deliberately diverges from these reflexes. **Wrong-by-instinct → what
actually happens → write instead:**

| Reflex | What happens in Epsil | Write instead |
|:--|:--|:--|
| `xs[0]` for first element | **Silently** yields `NaN` — indexing is **1-based** | `xs[1]`; negative indices work: `xs[-1]` is the last element |
| `7 // 2` floor division | **Silent wrong value**: `//` starts a comment, so this is just `7` | `floor(7 / 2)` |
| `7 / 2` integer division | Exact rational `7/2`, not `3` or `3.5` | `floor(7 / 2)` for `3`; `N(7 / 2)` for `3.5` |
| `range(1, 5)` excludes end | Inert call + did-you-mean; `Range(1, 5)` **includes** 5: `[1,2,3,4,5]` | `Range(1, n)` or `1..n` for 1…n inclusive |
| `x = 5` at top level | Assigns — `=` assigns only as a whole statement with a name on the left | `x == 5` for the equation |
| `# comment` | Diagnostic (`#` introduces pragmas) | `// comment` or `/* … */` |
| `def f(x):` / `(x) => …` / `lambda x: …` | Parse diagnostics; `(x) -> …` is recovered with a did-you-mean-`=>` fixit | `f(x) = expr`, `x => expr`, or `function f(x) { … }` |
| `cond ? a : b` | Parse diagnostic | `a if cond else b`, or `if cond { a } else { b }` — both are expressions |
| `elif` | Parse diagnostic | `else if` |
| `return` | Reserved word, **not implemented** | A block's value is its last expression |
| `break` / `continue` | Work as expected inside a `while`/`for` body; the loop context resets at every function and lambda boundary | *(nothing to change)* |
| `print(x)` | Inert unknown call; nothing prints | The program's value is its **last statement** |
| `len(xs)` | Inert + did-you-mean | `length(xs)` |
| `s[0]` / `len(s)` on a string | Works — a string is a collection of its characters (grapheme clusters), 1-based | `s[1]`, `length(s)` |
| `"a" + "b"` | Error values inside an `Add` | `"\(a) and \(b)"` interpolation, or `join(a, b)` |
| `xs[2] = 9` | Runtime error value — no element assignment; collections are immutable values | Rebuild: `map`; in a loop, `listFrom(join(xs, [v]))` |
| `and` / `or` / `not` | Parse diagnostics (reserved words) | `&&`, `\|\|`, `!` |
| `x**0.5` habits: `x^1/2` | Parses as `(x^1)/2` — precedence, not a root | `sqrt(x)` or `x^(1/2)` |
| `math.floor`, `np.mean` | No modules/namespaces | Everything is global: `floor`, `mean`, `sin`, … |
| `for` loop building a value | Loops are for **effect**; their value is `nothing` | Accumulate into a `let`, or use `map`/`filter`/`reduce` |
| f-strings / template literals | Backtick is the verbatim-symbol quote; `${}` invalid | `"x is \(x)"` works in any string |

Comfortable habits that **do** transfer: `**` is an accepted alias of `^`
(both right-associative, `2^3^2` → `512`); `%` is `Mod` with the sign
convention of Python (`-7 % 3` → `2`); `xs[-1]` is the last element; `0.1 +
0.2 == 0.3` is `True` (decimal arithmetic); chained comparisons `1 < 2 < 3`
work; `2 in [1, 2, 3]` works; lowercase `true`/`false` are accepted
(canonically `True`/`False`).

## Verified Idioms

The [Style Guide](/epsil/style/) states each idiom with its reason; this
section is the short form.

Exactness and numeric approximation:

```epsil
let exact = 1/3 + 1/6      // stays the exact rational 1/2
let sym = sqrt(2) * sqrt(2) // symbolic radicals reduce exactly
"\(exact), \(sym), \(N(pi, 10))"
// ➔ "1/2, 2, 3.141592654"
```

Functions, recursion (self-reference works in a one-step definition, with
any number of recursive calls — `fib(n-1) + fib(n-2)` is fine), and closures:

```epsil
fact(n) = 1 if n <= 1 else n * fact(n - 1)
makeAdder(k) = x => x + k     // closures capture lexically
let add10 = makeAdder(10)
add10(fact(5))
// ➔ 130
```

Collections pipeline — `map`/`filter`/`reduce` for value-producing iteration,
`|>` to chain; `1..n` is an inclusive range:

```epsil
1..10 |> filter(_, k => k % 2 == 0) |> map(k => k^2, _)
// ➔ [4, 16, 36, 64, 100]
```

```epsil
reduce([1, 2, 3, 4], (acc, x) => acc + x, 0) + sum(1..100)
// ➔ 5060
```

Loops are for effect — accumulate into a variable declared outside:

```epsil
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

Building a list in a loop — spread the old list into a new literal (each
literal snapshots the current value); never `join(xs, [k])` on every turn,
which nests a lazy recipe per turn and takes seconds by a thousand elements:

```epsil
let xs = []
for k in 1..3 { xs = [...xs, k * k] }
xs
// ➔ [1, 4, 9]
```

Structural `match` (an expression; `_` is the wildcard; a bare name **binds**
— use `== expr` to compare against a value):

```epsil
classify(n) = match n {
  0 => "zero"
  k if k > 0 => "positive"
  _ => "negative"
}
classify(-5)
// ➔ "negative"
```

Symbolic computation:

```epsil
let poly = simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
let roots = solve(x^2 + x - 6 == 0, x)
let deriv = D(x^3 + x, x)
let area = integrate(sin(x), (x, 0, pi))
(poly, roots, deriv, area)
// ➔ (4x^3 + 2x^2 + 3, [2,-3], 3x^2 + 1, 2)
```

Lists, slices, and common operators (all indexing is 1-based):

```epsil
let xs = [10, 20, 30, 40]
(xs[1..2], first(xs), last(xs), sort([3, 1, 2]), indexOf(xs, 30))
// ➔ ([10,20], 10, 40, [1,2,3], 3)
```

Dictionaries (string keys; dot access is shorthand for identifier-shaped
keys):

```epsil
let d = {one -> 1, two -> 2}
(d.two, d["two"], isMissing(d.missing), Coalesce(d.missing, 0))
// ➔ (2, 2, True, 0)
```

An absent numeric field evaluates to `NaN`; an absent nonnumeric field remains
`missing`. `isMissing` recognizes both forms.

## Library Quick Roster

Verified operator names, so you don't have to guess. The complete index, by
category with signatures, is the [Standard Library](/epsil/library/) page;
search by concept with `epsil doc <keywords>`.

- **Numbers**: `abs`, `floor`, `ceil` (not `Ceiling`), `round`, `sqrt`,
  `max`, `min` (each takes a list or varargs), `Mod`, `gcd`, `lcm`,
  `isPrime`, `random(a..b)`.
- **Lists**: `length`, `first`, `last`, `rest`, `take`, `drop`, `reverse`,
  `sort` (optional comparator — see below), `indexOf`, `join`, `append`,
  `sum`, `mean`, `standardDeviation` (sample, n−1), `map`, `filter`,
  `count(xs)` / `count(xs, v)` / `count(xs, pred)`,
  `reduce(list, f, init)`, `Range(a, b)` inclusive, `Range(a, b, step)`.
- **Strings**: `characters`, `stringSplit(s)` (splits on whitespace by
  default), `String(x)`, `join(a, b)` to concatenate strings,
  `StringJoin(xs, sep?)` to join ONE collection with an optional separator
  (a string subject means its characters, so `stringJoin("ab", "cd")` is
  `"acdb"`, not `"abcd"` — use `join` or `"\(a)\(b)"` to concatenate).
  Substring search is `rangeOf(s, needle)` (a span, or `nothing`),
  `containsSequence`, `startsWith`, `endsWith` — `c in s` is *character*
  membership. Also `StringReplace(s, target, replacement, count?)`,
  `trim`/`trimStart`/`trimEnd`, `stringRepeat`, `padStart`/`padEnd`,
  `toUpperCase`/`toLowerCase`/`caseFold`, `stringCompare(a, b)` (`-1/0/1`,
  code-point order) and `NumberFrom(s, base?)`.
- **Dictionaries**: `keys`, `values`.
- **Absence**: `missing` preserves a missing position; `nothing` is omitted
  from arguments and collections; `isMissing`, `Coalesce`.
- **Symbolic**: `simplify`, `HoldValues(body)` (evaluate `body` with its
  assigned symbols kept symbolic), `solve(eq == v, x)`, `D(expr, x)`,
  `derivative(f)`, `integrate`, `N`, `type`, `isError(x)` (true for an error
  value, or an expression carrying one).

Caution: `head` and `tail` exist but are **structural** operators
(`head([1,2,3])` is the *operator name* `"List"`, not the first element) —
for elements use `first`/`rest`.

```epsil
sort([3, 1, 4, 1, 5], (a, b) => a > b)
// ➔ [5,4,3,1,1]
```

## Watch Out For

- **Laziness**: `Range`, `map`, `filter`, `take`, `drop`, `join` are
  generators — they enumerate when materialized (indexed, aggregated, or
  iterated; e.g. a `take(xs, 3)` stored inside a tuple stays an unevaluated
  `Take(...)`), and a deferred mapping function reads variables **at
  materialization time**. Collection *literals* snapshot their element values
  immediately. To force work now, aggregate or index where you stand.
- **Output is the engine's textual form**: strings and booleans print
  *quoted* (`"True"`, `"florb"`) — that quoted `"True"` is a boolean, not a
  string. Derived collections (`Range`, `map`/`filter` results, loop-built
  lists) preview-elide above 10 elements (`[1,2,3,4,5,...,]`); the value is
  complete — the CLI's `--json` output materializes the full elements (up to
  10,000). Literals print in full.
- **Arguments are evaluated before a call** — `f(a + 1)` receives the value
  — except for a `hold` function (`hold f(e) = …`), which receives the
  expression as written and evaluates it wherever the body reads it
  (call-by-name: `hold twice(e) = e + e` evaluates `e` twice; `let v = e`
  once). Every parameter of a hold function is held; there is no
  per-parameter form.
- **Binder variables stay symbolic**: `D(expr, x)` and `integrate(expr, x)`
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
  — it binds a new variable named `pi`. Pin values with `==`:
  `match x { == Pi => … }`.
- **The dot calls protocol functions only**: `c.area()` is `area(c)` when
  `area` is a `protocol` function the type of `c` conforms to. A library
  function is not reached that way — `xs.Sort()` is the error
  `dot-call-not-a-protocol-function`; write `sort(xs)` or `xs |> sort`.

For the full reference start at [Epsil](/epsil/), the complete grammar in
[Syntax](/epsil/syntax/), and ~70 more verified programs in
[Examples](/epsil/examples/).
