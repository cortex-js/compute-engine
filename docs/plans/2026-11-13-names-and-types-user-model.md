# Names and types: what a user needs to know

Status: DRAFT for the user's review (session ce-desk, 2026-11-13). It is
written for a user of the Compute Engine and of Epsil, and it states the
model that the binding work aims at
(`2026-11-11-bound-once-spec.md`, section 11). It is not a guide page yet.

Every example was run on release 0.188.0 (`bd05d91fbc5c`), and the result
shown is the one it gave, with two changes of form: a list is printed with
spaces, and a type is printed by its name (`type(x)` gives a type value,
which prints as `TypeFrom("number")`); an error is shown as a comment.
The script that runs them is
`~/dev/compute-engine-recovery/fc-guide/guide.mts` (`npx tsx <script>` from
the repository root). Where the model says something else than 0.188.0 does, the text says
"**Not yet**" and gives both. Section 7 lists these places and the points
that are not decided.

## The model in eight rules

1. **A name means what it meant where you wrote it.** An expression reads
   each name from the place it was written in. A declaration or an
   assignment made later in that place is seen. A declaration made
   somewhere else is not.
2. **Nothing is declared for you.** A name you never declared is an
   unknown: it stays a symbol. A variable exists because you declared it
   (`let`), and an assignment writes a variable that exists.
3. **A name with no type is a number, until something says otherwise.**
   The engine notes what each use requires of it (`x + 1` requires a
   number, `length(x)` a collection). It uses these notes to type the
   expression and to report a conflict. It does not write them on the name.
4. **Types flow forward.** A type comes from a declaration, from the value a
   variable starts with, and from the argument of a call. You rarely write
   one.
5. **A parameter with no type takes one element at a time, unless the body
   uses it as a collection.** `f(x) = x^2` called with a list is applied to
   each element. `g(xs) = sum(xs)` takes the list whole.
6. **An operator applied to lists works element by element, and the lengths
   must agree.**
7. **A type you wrote is a promise that the engine enforces. A type the
   engine worked out is not.**
8. **A type does not depend on a value.** The type of an expression comes
   from the types of its names, never from what they hold at the moment.

## 1. Names

A name with no definition is an unknown. It computes symbolically.

```epsil
x + 1
// ➔ x + 1
type(x + 1)
// ➔ number
```

A function reads a variable when it is called, so a later assignment is
seen:

```epsil
let a = 2
f(x) = a * x
f(3)
// ➔ 6
a = 10
f(3)
// ➔ 30
```

A variable must be declared. An assignment to a name that was never
declared is an error, and so is a read before the declaration:

```epsil
c = 5
// error: `c` is not declared: write `let c = …`

let a = q + 1
let q = 2
// error: `q` is used before the statement that declares it in this block
```

A local of a function is local. A function that a call returns keeps the
values of that call:

```epsil
function area(r) {
  let k = r^2
  pi * k
}
area(3)
// ➔ 9pi
k
// ➔ k          (no `k` outside the function)

add(a) = x => x + a
let g = add(2)
let h = add(10)
(g(1), h(1))
// ➔ (3, 11)
```

## 2. What you get without writing a type

A variable has the type of the value it starts with:

```epsil
let xs = [1, 2, 3]
type(xs)
// ➔ vector<integer^3>
type(xs[1])
// ➔ integer
```

A function is typed from its body, and a call from its argument:

```epsil
f(x) = x^2 + 1
type(f)
// ➔ (x: unknown) -> number
f(3)
// ➔ 10
f([1, 2, 3])
// ➔ [2, 5, 10]
```

A function that uses its parameter as a collection takes a list whole
(rule 5):

```epsil
g(xs) = sum(xs)
type(g)
// ➔ (xs: collection) -> number
g([1, 2, 3])
// ➔ 6
```

The callback of `map`, `filter` and the like is typed from the elements:

```epsil
map(n => n^2, 1..5)
// ➔ [1, 4, 9, 16, 25]
filter([1, 2, 3, 4], x => x > 2)
// ➔ [3, 4]
```

Recursion, and a condition over a list, work element by element:

```epsil
fact(n) = 1 if n == 0 else n * fact(n - 1)
fact([3, 4])
// ➔ [6, 24]
sgn(x) = 1 if x > 0 else -1
sgn([-2, 3])
// ➔ [-1, 1]
```

## 3. The one rule for a parameter: whole or one element at a time

When you call a function with a list, there are two things it can mean.
`f(x) = x^2` with `[1, 2, 3]` should square each element. `g(xs) = sum(xs)`
with `[1, 2, 3]` should add them up. You write neither with a type, so the
engine reads the body:

**A parameter with no type takes its argument whole when the body uses it
as a collection. Otherwise the call is made once for each element.**

The body uses a parameter as a collection when the parameter is:

- the operand of an operation on collections: `length(x)`, `sort(x)`,
  `take(x, 2)`, an index `x[1]`, a spread `[...x, 0]`;
- the ONLY operand of an operation that also accepts numbers: `sum(x)`,
  `max(x)`, `mean(x)`. With a second operand it is not: `max(x, 2)` is the
  larger of two numbers;
- passed to a function that takes that argument whole;
- copied to a local that is used in one of these ways (`let q = s`, then
  `take(q, 2)`).

```epsil
mx(x) = max(x)
mx([1, 2, 3])
// ➔ 3
low(x) = max(x, 2)
low([1, 2, 3])
// ➔ [2, 2, 3]

l(p) = sqrt(p[1]^2 + p[2]^2)
k(p) = max(0, l(p))
k([3, 4])
// ➔ 5            (`k` passes `p` to `l`, which reads it by index)
```

A type decides it without reading the body. A collection type means whole,
a number type means one element at a time, and `any` means "whatever I am
given, whole":

```epsil
low2(x: list) = max(x, 2)
low2([1, 2, 3])
// ➔ 3
dbl(x: real) = 2x
dbl([1, 2, 3])
// ➔ [2, 4, 6]
depth(t: any) = 0 if t ∈ ℤ else 1
depth([[0, 0], 5])
// ➔ 1
```

The choice does not depend on the order in which the body uses the
parameter. **Not yet**: in 0.188.0 it does.

```epsil
q(x) = (length(x), x + x)
q([1, 2, 3])
// ➔ (3, [2, 4, 6])
p(x) = (x + x, length(x))
p([1, 2, 3])
// model: ([2, 4, 6], 3)
// 0.188.0: three tuples, each with an `incompatible-type` error
```

## 4. When to write a type

| Situation | Write | Why |
|---|---|---|
| The function takes a list or a matrix whole and the body does not show it | `(A: matrix)`, `(xs: list)` | Rule 5 reads the body; `A^2`, `[t, 2t]` and a constant body say nothing |
| The function should work on one element at a time although the body indexes or reduces | `(v: tuple<number, number>)`, `(x: real)` | The same rule, the other way |
| The argument can be anything (a number, a list, a nested list) and you handle it yourself | `(t: any)` | `any` is never mapped |
| A variable will hold values of a known kind and you want mistakes caught | `let n: integer = 3` | Rule 7: only a written type is enforced |
| You compile an expression whose input is not used in a way that types it | declare the input, or give its type to `compile()` | Compiled code needs the shape of every input |
| You compile a function as a value | annotate its parameters | The body alone does not settle a shape |
| You want an error at the call, before anything runs | annotate the parameters | A written type is checked when the call is written |

Examples of the first two rows:

```epsil
sq(A) = A^2
sq([[1, 2], [3, 4]])
// ➔ [[1, 4], [9, 16]]         (each cell squared)
sq2(A: matrix) = A^2
sq2([[1, 2], [3, 4]])
// ➔ [[7, 10], [15, 22]]       (the matrix product)

wrap(t) = [t, 2t]
wrap([1, 2, 3])
// ➔ [[1, 2], [2, 4], [3, 6]]
wrap2(t: list) = [t, 2t]
wrap2([1, 2, 3])
// ➔ [[1, 2, 3], [2, 4, 6]]
```

A written type is checked before the program runs; a worked-out type is
not a promise:

```epsil
area(r: real) = pi * r^2
area("3")
// static error: expected `real`, got `string`

f(x) = x + 1
type(f)
// ➔ (x: unknown) -> number
f(1/2)
// ➔ 3/2
f("a")
// ➔ an `incompatible-type` error value, and no error before the run

let n: integer = 3
n = 2.5
// error: expected `integer`, got `2.5`; `n` is still 3

let a = 1
a = "hello"
type(a)
// ➔ string                     (no type was written: the variable follows)
```

## 5. Things that may surprise you

Each entry gives the program, what you get, the reason, and what to write.

**A function that ignores its parameter still returns a list.**

```epsil
five(s) = 5
five([1, 2])
// ➔ [5, 5]
```

The body does not use `s` as a collection, so the call is made for each
element. Write `five(s: list) = 5` to get `5`.

**A matrix given to an untyped parameter is treated cell by cell.**
`sq(A) = A^2` above squares the cells. Two untyped matrices commute:

```epsil
c(A, B) = A * B - B * A
c([[1, 2], [3, 4]], [[0, 1], [1, 0]])
// ➔ [[0, 0], [0, 0]]
c2(A: matrix, B: matrix) = A * B - B * A
c2([[1, 2], [3, 4]], [[0, 1], [1, 0]])
// ➔ [[-1, -3], [3, 1]]
```

An untyped name is a number, and numbers commute. Write `A: matrix`. A body
that uses the parameters as matrices says it too
(`d(A, B) = determinant(A + B)` is typed `(A: matrix, B: matrix) -> number`).
**Not yet**: in 0.188.0 this works only when the matrix use comes first:
`(determinant(A), determinant(B), A * B - B * A)` gives the right matrix,
and `(A * B - B * A, determinant(A), determinant(B))` gives zeros.

**The same expression written directly and through a function can
differ.** `max([1, 2, 3], 2)` is `3`; `low(x) = max(x, 2)` with the same
list is `[2, 2, 3]`. Written directly, the list is an operand of `max`.
Through the function, `x` is one number at a time. This is rule 5. Write
`(x: list)` to get the direct reading.

**A point and a list of points.**

```epsil
h(v) = v[1] + v[2]
h((3, 4))
// ➔ 7
h([3, 4])
// ➔ 7
h([(1, 2), (3, 4)])
// model: (4, 6)      (the list is taken whole: its first element plus its second)
// 0.188.0: [3, 7]    (one call for each point)
```

The model's rule is rule 5: an indexed parameter takes its argument whole.
To get one call for each point, say that the parameter is a point:

```epsil
h2(v: tuple<number, number>) = v[1] + v[2]
h2([(1, 2), (3, 4)])
// ➔ [3, 7]
```

**Lists of different lengths do not pair up.**

```epsil
[1, 2, 3] + [10, 20]
// ➔ Error("incompatible-dimensions", "2 vs 3")
zip([1, 2, 3], [10, 20])
// ➔ [(1, 10), (2, 20)]
```

An operator between two lists needs the same length. To pair as far as
both go, write `zip`.

**A stored lazy list follows the variables it reads.**

```epsil
let k = 2
let big = filter(1..oo, n => n % k == 0)
take(big, 3)
// ➔ [2, 4, 6]
k = 3
take(big, 3)
// ➔ [3, 6, 9]
```

A lazy list computes an element when it is asked, with the values of that
moment, as a function does. To freeze the result, take the elements you
need into a list (`let firstThree = take(big, 3)`).

**A function that changes a variable outside itself must say so.**

```epsil
let total = 0
function bump(n) scope {
  total = total + n
  total
}
bump(5)
// ➔ 5
```

Without `scope` the call is refused ("writes outside a function require a
declared `scope` effect").

**Some one-letter names have a meaning.** `e` is Euler's number, `i` the
imaginary unit (`i^2` is `-1`), `pi` is π. You can use the name for
yourself with a declaration: `let i = 3`, then `i + 1` is `4`.

**The type of an expression does not follow the value of its names**
(rule 8). **Not yet**: 0.188.0 revises it.

```js
ce.assign('y', ce.parse('x + 1'));
ce.box('y').type;          // number
ce.assign('x', ce.parse('[1, 2]'));
ce.box('y').evaluate();    // [2, 3]
ce.box('y').type;          // model: number.  0.188.0: vector<integer^2>
```

When a variable can hold values of several shapes, declare it with the type
you need (`ce.declare('y', 'list<number> | number')`).

## 6. For an application that hosts the engine

**Parsing declares nothing.** The type that the uses require belongs to the
expression. `ce.infer()` writes it on the name when you want that.

```js
const e = ce.parse('x + 1');
e.type;                    // number
ce.box('x').type;          // unknown
ce.lookupDefinition('x');  // undefined

const s = ce.parse('\\sin(w) + 1');
ce.infer([s]);             // declares w: number
ce.box('w').type;          // number
```

In an Epsil program the statements are one unit: a later statement sees
what an earlier one required (`x + 1`, then `type(x)` is `number`).

**An expression keeps the place it was written in** (rule 1).

```js
const e = ce.parse('x + 1');
ce.declare('x', { type: 'integer', value: 2 });
e.evaluate();              // 3: a later declaration in the same scope is seen

const e2 = ce.parse('t + 1');
ce.pushScope();
ce.declare('t', { type: 'integer', value: 5 });
e2.evaluate();             // t + 1: a scope pushed later is not seen
ce.rebind(e2).evaluate();  // 6: `rebind` gives the expression as written here
ce.popScope();

ce.pushScope();
ce.declare('u', { type: 'integer', value: 5 });
const e3 = ce.parse('u + 1');
ce.popScope();
e3.evaluate();             // 6: the scope it was written in still answers
```

**To evaluate with values for a moment**, use `ce.withValues()`, not a
scope:

```js
const e = ce.parse('a + 1');
ce.withValues({ a: 3 }, () => e.evaluate());   // 4
e.evaluate();                                  // a + 1
```

**How `f(x)` is read.** A name followed by parentheses is a call, unless
the name is declared as something that is not a function:

```js
ce.parse('f(x)').json;      // ["f", "x"]
ce.parse('2(x+1)').json;    // ["Multiply", 2, ["Add", "x", 1]]
ce.declare('k', 'real');
ce.parse('k(x+1)').json;    // ["Multiply", "k", ["Add", "x", 1]]
```

**Compiling.** Compiled code does not look at the shape of a value when it
runs, so every input needs a type before.

| Program | Result |
|---|---|
| `compile(ce.parse('\\sin(w) v'))` | compiles: the uses type `w` and `v` |
| `compile(ce.parse('w'))` | refused: the input `w` has no type |
| `f := x ↦ x^2`; `compile(f(u))`, `u` not declared | refused: `u` has no type |
| the same with `u` declared `real` | compiles |
| `s := xs ↦ Sum(xs)`; `compile(s(L))`, `L: list<real>` | compiles: the argument types the parameter |
| `compile(s)`, the function as a value | refused: an element can be a number or a list |
| `s2 := (xs: list<real>) ↦ Sum(xs)`; `compile(s2)` | compiles |

Give the type with `ce.declare()`. A name that holds a value is folded
into the code; to keep it as an input, name it:
`compile(expr, { symbolic: ['a'] })` (in the release after 0.188.0). The
name is then an input wherever the compilation reads it, also inside the
functions that the expression calls. **Not yet**: the model also takes the
types at the call, `compile(expr, { inputs: { w: 'real' } })`, with no
declaration and no scope.

## 7. Where 0.188.0 differs, and what is not decided

Differences between this document and 0.188.0:

| Topic | This document | 0.188.0 | State |
|---|---|---|---|
| Rule 5 | The whole-or-element choice does not depend on the order of the uses | It does: `p(x) = (x + x, length(x))` gives errors | proposed, not decided |
| Rule 5 | A parameter used as a matrix after another use is still a matrix | Only when the matrix use comes first | proposed (box the body after the uses are known), not decided |
| Rule 5 | An indexed parameter with no type takes a list of points whole | One call for each point | proposed, not decided; it changes results |
| Rule 8 | A type does not follow a value | It is revised from the value | decided (D16); built, not landed |
| Compiling | `compile()` takes the types of its inputs | Declarations only | decided (C6); not built |

Not decided, each with the choice:

1. **Rule 5, "copied to a local".** 0.188.0 follows `let q = s`. Keeping it
   makes Epsil functions with a local copy work with no annotation; dropping
   it makes the rule shorter. Tycho does not need it.
2. **Rule 5 for a tuple of two numbers.** Today `h(v) = v[1] + v[2]` types
   `v` as a point, and a list of points is then mapped. In the model the
   parameter is "indexed, so whole", and a user who wants the mapping writes
   the point type. The model is simpler; 10 tests of the yardstick change
   their value.
3. **What the engine still works out for a parameter beyond whole-or-element**
   (the `tuple<number, number>` above, `collection`, `matrix`). The model
   keeps these types for what they are good for: the printed signature, an
   error in a body, compilation. They decide no value other than through
   rule 5 and the matrix case.
4. **A function that ignores its parameter** (`five(s) = 5` gives
   `[5, 5]`). Desmos gives `5` (measured by Tycho, 2026-11-13). The model
   keeps the engine's answer, because one rule covers it.
5. **Lists of different lengths.** Desmos pairs them to the shorter one;
   the engine refuses. Kept: Tycho's importer writes the pairing.
