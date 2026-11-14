# Names and types: what a user needs to know

Status: DRAFT for the user's review (session ce-desk, 2026-11-13). It is
written for a user of the Compute Engine and of Epsil, and it states the
model that the binding work aims at
(`2026-11-11-bound-once-spec.md`, section 11). It is not a guide page yet.

Every example was run, and the result shown is the one it gave, with two
changes of form: a list is printed with spaces, and a type is printed by
its name (`type(x)` gives a type value, which prints as
`TypeFrom("number")`); an error is shown as a comment. The examples of
sections 1 to 6 were run on release 0.188.0 (`bd05d91fbc5c`) with
`~/dev/compute-engine-recovery/fc-guide/guide.mts`; the examples of "The
model" were run on main at `1acef6a0eb641e2c18b7e1f2008e46f226b30d4a`
(0.188.1 and later commits) with `guide2.mts` and `guide3.mts` of the same
directory (`npx tsx <script>` from the repository root). Where the model
says something else than the engine does, the text says "**Not yet**" and
gives both. Section 7 lists these places and the points that are not
decided.

## The model

### Four words

- **Name.** An identifier in an expression: `x`, `total`, `f`.
- **Declared, undeclared.** A name is declared when the program introduces
  it: `let total = 0` makes a variable, and `f(x) = x^2` makes a function
  `f` and its parameter `x`. The engine declares some names itself (`pi`).
  Every other name is undeclared. An undeclared name is not an error: it
  stands for itself, as a letter does in algebra, and `x + 1` stays `x + 1`.
- **Scope.** The part of a program that a declaration belongs to: the whole
  program, the body of a function, a block `{ … }`. A scope inside another
  one reads the names of the outer one. The outer one does not read the
  names of the inner one. (A host application opens a scope with
  `ce.pushScope()`.)
- **Written type, worked-out type.** A type is written when you wrote it:
  `let n: integer = 3`, `f(x: real) = …`. When you wrote none, the engine
  works one out.

### Names

1. **An expression reads its names from the scope it was written in, and
   from the scopes around that one.** It reads the value that a name has
   when the expression is evaluated, so it sees an assignment made after it
   was written. It reads no other scope: not the body of another function,
   and not a scope that a host application opens later.

   ```epsil
   let rate = 2
   function cost(n) {
     rate * n        // `rate` is read from the program, the scope around `cost`
   }
   cost(3)
   // ➔ 6
   rate = 5
   cost(3)
   // ➔ 15           (the assignment made later is seen)

   function area(r) {
     let k = r^2
     pi * k
   }
   area(3)
   // ➔ 9pi
   k
   // ➔ k            (the program does not read the scope of `area`)
   ```

2. **Only a declaration makes a variable.** Using a name declares nothing:
   a name that you only use stays undeclared. Assigning to a name that was
   never declared is an error.

### Types

3. **The type of a name comes from its declaration.**

   | The name is | Its type is |
   |---|---|
   | declared with a written type | the written type |
   | a variable with no written type | the type of the value last assigned to it |
   | a function | worked out from its body: `f(x) = x^2 + 1` is `(x: unknown) -> number` |
   | a parameter with no written type | what the body requires of it (`collection` in `g(xs) = sum(xs)`), or none |
   | undeclared | none |

   "None" prints as `unknown`: `type(x)` is `unknown` for an undeclared `x`
   that nothing has used yet.

4. **Where a name has no type, the operator applied to it decides how it is
   read.** Arithmetic reads it as a number, so `x + 1` is a `number`.
   `length(x)` reads it as a collection. The reading is not a declaration:
   the name stays undeclared. How long the reading holds depends on who
   gave the expression:

   - In an Epsil program, it holds for the rest of the program. A later use
     that the reading does not allow is an error.
   - For a host application, it holds for that one expression. `ce.infer()`
     records it on the name when the host wants that (section 6).
   - For a parameter, it holds for the body of its function.

   ```epsil
   x + 1
   type(x)
   // ➔ number       (read as a number by `+`)
   length(x)
   // error: expected `collection`, got `number` at `x`
   ```

   ```js
   ce.parse('x + 1').type;    // number
   ce.box('x').type;          // unknown: the reading belongs to that expression
   ```

5. **A written type is enforced. A worked-out type is not.** A value that
   does not fit a written type is refused. A worked-out type only says what
   the engine found, and a variable with no written type accepts a value of
   another type.

   ```epsil
   let n: integer = 3
   n = 2.5
   // error: expected `integer`, got `2.5`; `n` is still 3

   let a = 1
   type(a)
   // ➔ integer
   a = "hello"
   type(a)
   // ➔ string       (no type was written: the type follows the assignment)
   ```

6. **A type changes only at a declaration or an assignment.** Evaluating
   an expression changes values and never a type. Assigning a variable a
   new value of the same type changes no type. An assignment that changes
   the type of a variable (`x = [1, 2]` after `x = 1`) changes the type of
   that variable, and of each variable whose value is a formula that reads
   it: a formula has the type that the types of its names give it, never
   the type that their values give it. On main since
   `ed611a362935da6c409793ba6093a9df0fbacf67`, not released.

### Lists

7. **A function called with a list is applied to each element, unless it
   takes the list whole.** `f(x) = x^2` called with `[1, 2, 3]` is called
   three times and gives the list of the three results. A function takes
   the list whole when its parameter has a written collection type, or when
   its body uses the parameter as a collection: `g(xs) = sum(xs)` gives one
   number. Section 3 has the exact rule. The type of a function describes
   ONE application: with `f` of type `(x: unknown) -> number`, `f(3)` is a
   `number` and `f([1, 2, 3])` is a list of three numbers.

8. **An operator between two lists pairs their elements, so the two lists
   must have the same length.** `[1, 2, 3] + [10, 20, 30]` is
   `[11, 22, 33]`, and `[1, 2, 3] + [10, 20]` is an error. Between a list
   and a number, the number is used with each element: `[1, 2, 3] + 10` is
   `[11, 12, 13]`.

## 1. Names

An undeclared name stands for itself, and the engine computes with it as
algebra does (rules 2 and 4):

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

A variable declared inside a function exists only inside that function
(rule 1). A function that a call returns keeps the values of that call:

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

The type of `f` describes one application of it: `f(3)` is a `number`. A
list argument is rule 7: `f` is applied to each element, and
`type(f([1, 2, 3]))` is `vector<3>`, a list of three numbers.

A function that uses its parameter as a collection takes a list whole
(rule 7):

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
| The function takes a list or a matrix whole and the body does not show it | `(A: matrix)`, `(xs: list)` | Rule 7 reads the body; `A^2`, `[t, 2t]` and a constant body say nothing |
| The function should work on one element at a time although the body indexes or reduces | `(v: tuple<number, number>)`, `(x: real)` | The same rule, the other way |
| The argument can be anything (a number, a list, a nested list) and you handle it yourself | `(t: any)` | `any` is never mapped |
| A variable will hold values of a known kind and you want mistakes caught | `let n: integer = 3` | Rule 5: only a written type is enforced |
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
Through the function, `x` is one number at a time. This is rule 7. Write
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

The model's rule is rule 7: an indexed parameter takes its argument whole.
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

**A variable that holds a formula follows the types of the names it
reads, not their values** (rule 6). On main, not released; 0.188.1 reads
the values.

```js
ce.assign('y', ce.parse('x + 1'));
ce.expr('y').type;          // number
ce.assign('x', 2);
ce.expr('y').type;          // integer: the type of x + 1 for an integer x
ce.assign('x', ce.parse('[1, 2]'));
ce.expr('y').evaluate();    // [2, 3]
ce.expr('y').type;          // vector<integer^2>
ce.assign('x', ce.parse('[5, 6]'));
ce.expr('y').type;          // vector<integer^2>: the same type, nothing changes
```

The type of an expression is the one that holds for every value its names
may take: with `x` declared `real` and holding 4, `sqrt(x)` is typed
`complex` and its value is 2.

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

**An expression keeps the scope it was written in** (rule 1).

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

Give the type with `ce.declare()`, or at the call:
`compile(expr, { inputs: { w: 'real' } })` needs no declaration and no
scope (on main since `ccd2f604697ac643c7a052389a921d353e066abb`, not yet
released). A name that holds a value is folded into the code; to keep it as
an input, name it: `compile(expr, { symbolic: ['a'] })` (since 0.188.1), or
give it in `inputs`. The name is then an input wherever the compilation
reads it, also inside the functions that the expression calls.

## 7. Where 0.188.0 differs, and what is not decided

Differences between this document and 0.188.0:

| Topic | This document | 0.188.0 | State |
|---|---|---|---|
| Rule 7 | The whole-or-element choice does not depend on the order of the uses | It does: `p(x) = (x + x, length(x))` gives errors | proposed, not decided |
| Rule 7 | A parameter used as a matrix after another use is still a matrix | Only when the matrix use comes first | proposed (box the body after the uses are known), not decided |
| Rule 7 | An indexed parameter with no type takes a list of points whole | One call for each point | proposed, not decided; it changes results |
| Rule 6 | A type follows the types of the names, never their values | The type of an expression is revised from the values its names hold | decided (D16); on main since `ed611a362935da6c409793ba6093a9df0fbacf67`, not released |
| Compiling | `compile()` takes the types of its inputs | Declarations only | decided (C6); built, on main, not released |

Not decided, each with the choice:

1. **Rule 7, "copied to a local".** 0.188.0 follows `let q = s`. Keeping it
   makes Epsil functions with a local copy work with no annotation; dropping
   it makes the rule shorter. Tycho does not need it.
2. **Rule 7 for a tuple of two numbers.** Today `h(v) = v[1] + v[2]` types
   `v` as a point, and a list of points is then mapped. In the model the
   parameter is "indexed, so whole", and a user who wants the mapping writes
   the point type. The model is simpler; 10 tests of the yardstick change
   their value.
3. **What the engine still works out for a parameter beyond whole-or-element**
   (the `tuple<number, number>` above, `collection`, `matrix`). The model
   keeps these types for what they are good for: the printed signature, an
   error in a body, compilation. They decide no value other than through
   rule 7 and the matrix case.
4. **A function that ignores its parameter** (`five(s) = 5` gives
   `[5, 5]`). Desmos gives `5` (measured by Tycho, 2026-11-13). The model
   keeps the engine's answer, because one rule covers it.
5. **Lists of different lengths.** Desmos pairs them to the shorter one;
   the engine refuses. Kept: Tycho's importer writes the pairing.
6. **A worked-out type set once and enforced** (the user's direction,
   2026-11-13). The type of a variable that is not a constant is taken
   broadly from its first value (sizes dropped, a number typed
   `nan | real | signed_infinity`) and then enforced, so `let a = 1`
   followed by `a = "hello"` is an error and no type ever changes; a
   `const` keeps its exact type. With it, rules 5 and 6 become one
   sentence. Measured, not landed
   (`~/dev/compute-engine-recovery/fc-d16/report-r6.md` and
   `s2-investigation.md`):
   - 494 tests change, most of them a printed type;
   - 96 operators with an `integer`, `real` or `complex` parameter refuse
     the broad number type in the Epsil static check (`let x = 5`,
     `x = x + 3`, `x % 2` is an error); 68 of them take an `integer`, so
     plain `real` does not help them;
   - 90 assignments are refused in 84 tests; about 45 are reasonable
     programs: 29 assign an error value or a failed cell, 10 start from a
     placeholder (`let r = 0`, then a list or a record);
   - four compiles decline because the size is no longer in the type; a
     `const` or a written type gives the old code back;
   - `1/0` evaluates to `~oo`, which the type refuses; no program of the
     suite assigns it.

   A narrower variant, not measured: fix and enforce the KIND of a
   variable (a number, a list of numbers, a string, a point), drop the
   sizes, and let the number type inside the kind widen (`integer` to
   `real`). It keeps `integer` for counts and indices, and it still needs
   a decision for an error value assigned to a typed variable and for a
   placeholder first value.
