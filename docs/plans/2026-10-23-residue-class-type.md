# A type for residue classes

**Status:** IMPLEMENTED on 2026-10-23 (built in a worktree, dual code review
applied, full suite green, applied onto the main tree and staged, not yet
committed); revised the same day after a dual design review (Claude and Codex; the merged
findings are in `docs/scratch/RESIDUE-CLASS-TYPE_SPEC_REVIEW.md`). The user
chose this design over a flag on the operator definition and decided the four
questions of section 9. Section 7 holds the measurements of the
implementation; section 11 the differences between the plan and the code.
ROADMAP entry: CE-136. GitHub issue:
[#471](https://github.com/cortex-js/compute-engine/issues/471).

## 1. The problem

`ResidueClass(k, n)` is the class of the integer `k` modulo `n`, an element of
ℤ/nℤ. The ordinary rules for numbers give wrong answers for these values:

- `c/c` is not the integer 1 when `c` has no inverse modulo `n`
  (`ResidueClass(2, 4)` has none);
- `c - c` is the class 0, not the integer 0;
- `c + ∞` is not `∞`.

Today the engine keeps these rules away from residue classes in two steps.

1. **Admission.** A class has the type `value`. The arithmetic operators
   accept it because `value` overlaps `number`: `Add` and `Max` are declared
   over `value`, and the numeric checks of the other operators
   (`checkNumericArgs()` and `nonNumericOperandError()` in
   `src/compute-engine/boxed-expression/validate.ts`, 17 calls in
   `library/arithmetic.ts`) pass an operand whose type could be a number.
2. **Protection.** Before a rule of canonicalization, evaluation,
   simplification, `Expand`, `Factor`, `Solve` or `Integrate` changes an
   expression, it calls `containsResidueClass()`
   (`src/compute-engine/boxed-expression/residue-class.ts`). That function
   walks the expression and the values of its symbols, and looks for an
   operator whose NAME is `ResidueClass`. There are 38 call sites in 11 files.
   The type handlers of the arithmetic operators use a second test,
   `isResidueClassOperand()`, so that an arithmetic expression that holds a
   class is typed `value`, not a number type.

Both steps work by accident of the type `value`. The admission is not stated
anywhere: a class passes a `number` parameter because the engine cannot tell
it from a number. The protection reads a name, so a head with another name
gets none. Example from issue #471, with `MyMod` declared by the reporter with
the signature `(any, any) -> value`:

| Expression, with `c = 2 mod 4` | `ResidueClass` today | `MyMod` today |
| --- | --- | --- |
| `(c/c).simplify()` | `c / c` (correct) | `1` (wrong) |

The reporter's head (`IntegerMod`, with the semantics of Sage's `Mod`: it
combines classes of different moduli, and a class compares equal to an
integer) cannot be rewritten to `ResidueClass`, because its arithmetic is
different.

## 2. What was measured (2026-10-23, commit `be0cd42cd`)

**A value type that is not a number, today.** The type `color` is in the
position the new type takes (a member of `VALUE_TYPES`, not a number, not a
collection), so arithmetic over it shows what the new type does with no other
change:

| Expression, with `k: color`, or `MyMod` declared `(any, any) -> color` | Result today |
| --- | --- |
| `k/k`, `-k`, `k + k`, `k^2`, `k · (1, 2)` | `incompatible-type` error, expected `number`, got `color` |
| `MyMod(2, 4) / MyMod(2, 4)`, also after `simplify()` | the same error |
| `g := k ↦ MyMod(k, 4)` | typed `(unknown) -> color`; `g(2)` is typed `color` |
| `Max(k, 3)` | typed `number`, stays `max(3, k)`; no error |
| `Equal(k, k)` | typed `boolean`; no error |
| `compile(Max(k, x))` | `Math.max(_.k, _.x)`: the compiler reads `k` as a number (ROADMAP CE-393) |

So a value type that is not a number is refused by every arithmetic operator,
the inferred signature of a function literal follows the declared result type
of the head its body calls, and `Max` accepts it with a `number` type.

**The gaps of the name test.**

- With `g := k ↦ ResidueClass(k, 4)`, `g(2)/g(2)` simplifies to
  `ResidueClass(2, 4) / ResidueClass(2, 4)`: correct. (ROADMAP CE-136 once
  said `1`; that is no longer true.) `f(c)/f(c)`, with no definition of `f`,
  is kept as it is.
- A head with another name is not protected (the table of section 1).
- A symbol declared `value` and boxed in a quotient before it holds a class:
  with `w: value`, `w/w` is `1` when it is boxed, and stays `1` after
  `w := ResidueClass(2, 4)`. See 4.8.
- `Max(c, x)` with a class `c` is typed `number`.

**The cost of a type test.** A timing of `containsResidueClass()` and of a
read of `expr.type` for each expression it is called on. One process, the
same numbers on two runs:

| Workload | Total | Calls | Name test | Type read |
| --- | --- | --- | --- | --- |
| Ordinary `simplify()` and `evaluate()`, an engine that never made a class | 125 ms | 26 823 | 0.7 ms | none |
| The same, in an engine that made one class | 102 ms | 26 823 | 1.8 ms | 12 ms |
| Residue-class arithmetic | 46 ms | 4 028 | 0.5 ms | 3.4 ms |

The name test is almost free, because its answer is kept with each expression
node. Nearly all the cost of the type read is the first computation of types
that nothing else asked for (5 889 expressions). The design does not read
`expr.type` (4.5); the acceptance threshold is in section 7.

**Tests and documentation that name the type.** No snapshot mentions
`ResidueClass`. About 8 assertions in
`test/compute-engine/item-399-residue-class.test.ts` expect the type `value`
or `set<value>`; that file also requires `Multiply(c, Tuple(1, 2))` to be a
tuple of classes (line 1177) and `Add(NaN, c)` to be `NaN` (lines 270, 717).
`doc/90-reference-sets.md` and `doc/96-reference-number-theory.md` describe
the class type.

## 3. What other systems do

From a survey of the documentation on 2026-10-23.

- **Sage and GAP.** Each element of ℤ/nℤ has a parent (Sage) or a family
  (GAP), which acts as its type. The parent defines the arithmetic, and the
  general simplifier never reads the element as a number. In Sage, a package
  defines a new kind of element by defining a new parent and its coercions
  (https://doc.sagemath.org/html/en/reference/coercion/index.html).
- **Mathematica.** `Mod` returns an integer. `FiniteFieldElement` (version
  13.3) is an atomic object that carries its field, so ordinary rules do not
  reach inside it
  (https://reference.wolfram.com/language/ref/FiniteFieldElement.html).
- **SymPy.** `Mod` is an ordinary integer function. The elements of `GF(p)` in
  the polynomial module are not symbolic expressions, so `simplify` never sees
  them (https://docs.sympy.org/latest/modules/polys/domainsintro.html).
- **Maple and Maxima.** A mode (`e mod m`, the option variable `modulus`)
  around plain integers, not a type of value
  (https://www.maplesoft.com/support/help/Maple/view.aspx?path=mod).

What applies here: no system protects these values with a flag on a function
name; the protection comes from the kind of the value. The kind protects; it
does not define the arithmetic. Each parent (each head here) keeps its own
arithmetic and its own rules for values of different moduli.

## 4. The design

In one sentence: residue classes move from "admitted by accident, detected by
name" to "admitted where a signature says so, refused everywhere else, and
protected by their type".

### 4.1 A primitive type `residue`

Add `residue` to `VALUE_TYPES` in `src/common/type/primitive.ts`, beside
`color`, `regexp` and `type`: a value that is not a number, not a boolean, not
a string and not a collection. The parser and the printer of types read the
list of primitive types, so `residue` can be written in a signature and in a
declaration.

The rules in the type lattice follow `color` and `regexp` exactly; the work
adds a test row for each:

- `residue` is a subtype of `value`, `expression` and `any`; it is disjoint
  from `number` and every numeric type, from `boolean`, `string`,
  `character`, and every collection type.
- The join of `residue` with a number type is the union: `widen('residue',
  'integer')` is `integer | residue`, and a union with a `residue` arm is not
  reduced to `value`. The join with `unknown` is `residue` (the general rule
  of `docs/plans/2026-10-21-unknown-inference-marker.md`: the join is neutral
  in `unknown`). The meet with `number` is `never`.
- `list<residue>` and `set<residue>` are ordinary collections of a
  non-number element. A list of classes is read by its cells, as a list of
  booleans is (`cellTypeMayCarryDimensions()` answers `true` for every
  primitive that is not a list, `color` and `residue` included): `[c, d]` is
  a `list<residue^2>`. A `residue` cell cannot hold a number, so such a list
  never prints as a `vector` or a `tensor`, and `broadcastable<residue>` is
  not a spelling the library uses. (An earlier version of this plan said the
  predicate answers `false`; the code was read on 2026-10-23.)
- A symbol declared `residue` accepts a value whose type is `residue`
  (`ResidueClass(2, 4)`, a value of a head declared `-> residue`) and refuses
  an integer: `ce.assign('r', 2)` for `r: residue` throws, as for every
  declared type that the value does not match (user decisions P1 to P5,
  `docs/plans/2026-10-21-presence-contracts-and-assertion.md`). An integer is
  a representative of a class, not the class, as `Element(7, ℤ/5ℤ)` is
  `False` today.
- The compiled targets (JavaScript, GLSL, WGSL, interval, Python) decline an
  input or an operand of type `residue` and an operator whose result type is
  `residue`: compiled arithmetic is over numbers. Today `compile()` already
  refuses a `ResidueClass` call ("target 'javascript' has no …"); the type
  makes a declared input `r: residue` decline too. (CE-393 records that a
  `color` input is compiled as a number today; the fix for `residue` is the
  same fix.)

`docs/TYPE-SYSTEM.md` gets a section with these rules.

### 4.2 `ResidueClass` returns it

The signature of `ResidueClass` (`src/compute-engine/library/sets.ts`)
becomes `(any, any) -> residue`. A call with a symbolic operand,
`ResidueClass(k, 4)`, has the type too; the name test already treats such a
call as a class. The element type of `ℤ/nℤ` (`QuotientRing`) becomes
`set<residue>`.

### 4.3 Explicit admission by the arithmetic operators

Section 2 shows what happens with no other change: every arithmetic operator
refuses a class. The operators that have residue arithmetic (the `residue*`
functions in `residue-class.ts`) admit the type in their signatures, and
their numeric checks admit it too. Today:

| Operator | Signature today | Admits a class through |
| --- | --- | --- |
| `Add` | `(value+) -> value` | the signature; `checkNumericArgs()` in its canonical handler refuses `color` |
| `Subtract` | `(number+) -> number` | `value` overlapping `number` |
| `Multiply` | `(number*) -> number` | the same |
| `Divide`, `Negate`, `Root` | `(complex \| infinity, …) -> number` | the same |
| `Power` | `(complex \| infinity, complex \| signed_infinity) -> number` | the same |
| `Square` | `(number) -> number` | the same |
| `Sqrt` | `(complex \| infinity) -> complex \| infinity` | the same |

The change: each of these nine signatures adds `residue` to the parameters
that take a class (`(complex | infinity | residue, …)`), and
`checkNumericArgs()` and `nonNumericOperandError()` accept an operand whose
type is `residue` or has a `residue` arm, so that the residue branch of the
`evaluate` handler is reached, as today. The numeric checks must keep refusing
`color`, `string`, a boolean and a collection where they refuse them today: a
test runs the table of section 2 with `k: color` after the change and expects
the same errors.

An operator that is not in the table refuses a `residue` operand at boxing
with `incompatible-type`, through its declared parameter type: `Sin(c)`,
`Floor(c)`, `Sign(c)`, `Abs(c)`. Today `Sin(c)` is admitted and stays
unevaluated. The CHANGELOG lists this under "Behavior Changes".

### 4.4 The type handlers of the arithmetic operators

The handlers that answer `value` for an operand that holds a class (the uses
of `isResidueClassOperand()` in `src/compute-engine/library/arithmetic.ts`)
answer `residue` for the SCALAR case only. The order of the answers is:

1. an operand that can be absent or `NaN` beside a class keeps today's
   answer (`Add(NaN, c)` is `NaN`; its type keeps the `nan` arm);
2. a collection operand beside a class keeps the broadcast answer
   (`Multiply(c, Tuple(1, 2))` is a tuple of classes, typed
   `tuple<residue, residue>`);
3. otherwise `residue`.

A type table the work pins with tests:

| Expression | Type |
| --- | --- |
| `c + d`, same modulus | `residue` |
| `c + d`, different moduli (stays unevaluated) | `residue` |
| `c + 3` (the integer is read in the ring) | `residue` |
| `c + 1.5` (a float is not read in the ring; stays unevaluated) | `residue` |
| `c + x`, `x: number` or `x: unknown` | `residue` |
| `c · ∞` | `residue` |
| `c^2`, `c^(1/2)`, `Sqrt(c)`, `Root(c, 3)` | `residue` |
| `NaN + c` | `nan` |
| `c · (1, 2)` | `tuple<residue, residue>` |
| `c · [1, 2]` | `list<residue>` |

`isResidueClassOperand()` (`describesClass()`) tests in this order: a number
type ends the walk with `false`, as today; a type that is `residue` or has a
`residue` arm answers `true`; otherwise (`value`, `unknown`, `any`) the walk
of the operand's structure and of a symbol's value runs as today. The
descriptor's type is computed for the type handler in any case, so this adds
no type computation.

### 4.5 The protection test reads type evidence

`containsResidueClass()` keeps its structure: a walk of the expression and of
the values of its symbols. The test at each node has three sources of
evidence, in this order:

1. **The name.** The operator is `ResidueClass`. Structural, kept with the
   node in `CLASS_FACTS` as today.
2. **The result type of the callee.** The result type of the signature that
   the engine resolved for the call: the operator definition of a named call,
   the value definition's function type of a named call bound to a value
   (`g(2)` with `g := k ↦ ResidueClass(k, 4)`, whose inferred signature is
   `(unknown) -> residue`, by the measurement of section 2), or the callee's
   type of an `Apply(g, 2)`. The node is protected when that result type is
   `residue` or has a `residue` arm, in any overload arm. A `type:` handler
   is not consulted: a head with a handler that returns classes must also
   declare `-> residue` in its signature, and the documentation of the
   definition says so. This source reads a definition that the node already
   holds, not `expr.type`; its answer is NOT cached, because a signature can
   change (an inferred signature is replaced by `_inferWithoutFacts()` in
   `boxed-function.ts`, and a rollback restores it), and a cached answer
   would depend on the order of queries.
3. **The declared type of a symbol.** A symbol whose declared type is
   `residue` or has a `residue` arm holds a class, with or without a value
   (`symbolHolds()` reads the type before it follows the value).

The engine-level shortcut stays, with more entry routes. An engine joins
`enginesWithClasses` when:

- it makes a `ResidueClass` call (as today, in the `BoxedFunction`
  constructor);
- it makes a call of an operator whose result type is `residue` or has a
  `residue` arm;
- a symbol or an operator is declared with a type that has a `residue` arm
  anywhere (a symbol `r: residue`, a signature `-> residue`, a function type
  `(integer) -> residue`), at declaration time;
- a value whose type has a `residue` arm is assigned to a symbol
  (`noteResidueClassValue()` runs for an engine not yet in the set, and
  joins it).

A test checks each route in a fresh engine: declare, then evaluate `r/r`,
`r - r`, `r + ∞` before any `ResidueClass` call is made.

### 4.6 The arithmetic of `ResidueClass` stays its own

`residueOf()` and the `residue*` functions keep their test on the name
`ResidueClass`. Another head with the type gets the protection and the
admission only: the engine does not fold `MyMod(2, 4) + MyMod(3, 4)`. The
head defines its own arithmetic, for example in an `evaluate` handler. This
follows the reporter's case: their arithmetic is not the arithmetic of
`ResidueClass`.

### 4.7 Order, equality and `Max`/`Min`

Residue classes have no order. The decision (user, 2026-10-23): `Max(c, x)`
and `Min(c, x)`, where `c` has the type `residue`, are an `incompatible-type`
error.

`Max` is declared `(value*) -> number` and `Min` `(value+) -> number`, so
that they accept a collection (`Max([1, 2])`) and omit `Nothing`. A
parameter type cannot spell "`value` but not `residue`", and a `canonical`
handler that refused the class skipped the inference of a free symbol from
the `value` parameter (`Max(x, 2x - 1)` no longer typed `x`; measured
2026-10-23). So the refusal is at evaluation: `processMinMaxItem()` answers
an `incompatible-type` error for a datum that is a class, as an operand, an
element of a collection or an element of a lazy source, before the
empty-input and `NaN` answers. At boxing, the type handlers of `Max` and
`Min` type a call with an operand whose type has a `residue` arm (`residue`,
`list<integer | residue>`, `set<residue>`) as `error`
(`residueExtremumError()`): an expression typed `error` is one that
evaluates to an error of its own, the convention `addTypeOnTypes` uses for a
bad tuple mix. A symbol typed `value` whose value is a class later is refused
at evaluation only (4.8).

The comparisons stay as they are: `Equal`, `NotEqual`, `Less` and the others
are declared over `any`. `Equal(c, c)` is `True` and `Equal(c, d)` for two
different classes is `False` by `isSame()`, as today (the fix of
`647a5cea3` keeps `simplify()` from deciding it wrongly). `Less(c, d)`,
`Less(c, 3)` stay unevaluated, as today. `Equal(c, 2)` stays unevaluated too,
for `ResidueClass` as for another head (measured 2026-10-23; an earlier
version of this plan said `False`). A head with another equality (the
reporter's `IntegerMod`
compares equal to an integer) defines it in its own `evaluate` handler for
`Equal`, which is outside this plan. `isSame()` is syntactic and does not
change.

### 4.8 What the design does not change: a symbol typed `value` or `unknown`

A rule that changes an expression still runs when nothing shows that the
expression holds a class. With `w: value`, `w/w` is `1` when it is boxed and
stays `1` after `w := ResidueClass(2, 4)`. An undeclared symbol has the same
situation: `x/x` is `1` because the engine types an undeclared symbol
`number` (ARCHITECTURE.md, "Non-finite typing convention for type
handlers"). A rule that waits for proof of a number would stop `x/x = 1` for
every undeclared symbol, which is the normal LaTeX input, so it is not an
option (user decision 2026-10-23: the measurement of such a rule, planned in
an earlier version of this document, is dropped).

The fix is the declaration: a symbol that will hold a class is declared
`residue` (`w: residue`), and 4.5 protects it before and after it holds a
value. The documentation of `ResidueClass` says so, and ROADMAP CE-136 keeps
only this documentation point after the work lands.

## 5. Public changes

- A new type name, `residue`, in the type language.
- The type of `ResidueClass(…)` changes from `value` to `residue`, the type
  of arithmetic over classes from `value` to `residue`, and the element type
  of `ℤ/nℤ` from `value` to `residue`. A host that compares a type string
  with `'value'` sees the change.
- An operator with no residue arithmetic refuses a class at boxing
  (`Sin(c)`, `Floor(c)`, `Max(c, x)`): it was admitted and stayed
  unevaluated.
- An extension head declares `-> residue` in its signature and gets the
  admission and the protection of `ResidueClass`, not its arithmetic.
- A symbol declared `residue` is protected with or without a value.

The CHANGELOG describes these under "Behavior Changes".

## 6. Tests

- The table of section 1 for a declared head with the signature
  `(any, any) -> residue`: `c/c`, `c - c`, `c + ∞`, `Equal(c, c)`,
  `Expand`, `Factor`, through `simplify()`, `evaluate()` and `N()`, on the
  box and the parse routes.
- The table of section 2 with `k: color`, unchanged after the work: the
  numeric checks still refuse a non-number value that is not a class.
- A head that returns `value` is not protected (no change for it).
- Each entry route of 4.5 in a fresh engine, before any `ResidueClass` call.
- A named call bound to a value definition, and `Apply(g, 2)`, with
  `g := k ↦ ResidueClass(k, 4)`; the inferred signature string
  `(unknown) -> residue`.
- Protection queried before and after a signature changes (an Epsil static
  check that rolls back an inferred signature).
- The type table of 4.4; the 8 assertions of
  `item-399-residue-class.test.ts` updated; the tuple and `NaN` tests there
  unchanged.
- `Max(c, 3)`, `Max(c, x)`, `Max([c, 1])`, `Max(ℤ/4ℤ)`, `Min(c, x)`: errors;
  `Max(w, x)` with `w: value`: unchanged.
- `Sin(c)`, `Floor(c)`, `Sign(c)`: `incompatible-type`.
- `ce.assign('r', 2)` for `r: residue` throws; `ce.assign('r',
  ResidueClass(2, 4))` binds.
- `compile()` declines an input `r: residue` and an expression with a class.
- An engine that never makes a class or a declaration with `residue`: the
  test makes no walk (a counter, as in the timing of section 2).

## 7. Measurements before the work lands

- The full test suite: the number of changed results and snapshots, reported
  with examples before landing.
- The timing of section 2 again, with the new test against the current test.
  Threshold: in each of the three workloads, the new test costs at most twice
  the name test (under 4 ms in the second workload), and an engine with no
  class and no `residue` declaration pays the same as today (under 1 ms).

**Measured 2026-10-23 on the implementation** (three runs each, the same
workloads as section 2, load average 5 to 6 on 18 cores):

| Workload | Total | Checks | Name test (before) | New test |
| --- | --- | --- | --- | --- |
| Ordinary, an engine that never made a class | 135 to 155 ms | 26 823 | 0.6 ms | 0.5 to 0.6 ms |
| Ordinary, an engine that made one class | 105 to 130 ms | 26 823 | 1.8 ms | 4.5 to 5.7 ms |
| Ordinary, an engine with `r: residue` declared | 100 to 130 ms | 26 823 | (none) | 5.2 to 6.4 ms |
| Residue-class arithmetic | 40 to 55 ms | 4 028 | 0.5 ms | 0.5 to 0.7 ms |

The first and the last workloads meet the threshold. The second does not:
the new test costs about 5 ms, three times the name test, about 200 ns per
check and 4 to 5% of the workload. The split (one run): the structural walk
for the name, 1 ms; the walk for a callee declared to return `residue`,
2 ms; the collection and the types of the symbols, 2 ms. Two caches were
tried and kept: the answer of `signatureReturnsResidue()` per signature
object (which removed most of the callee walk's cost: 5 to 9 ms before it),
and the answer of the callee walk per expression whose callees are all
library operators (`CALLEE_FACTS`); the second does not show in this
workload, which boxes new expressions in each round, but the engine reuses
canonical expressions. The reading of the symbols' types runs only in an
engine where a symbol or an operator was declared with a `residue` type
(`enginesWithResidueDeclarations`). An engine that never uses classes pays
nothing, as before. Whether the 4 to 5% in an engine that uses classes is
acceptable is for the user to decide; the alternative is to drop the callee
evidence (source 2 of 4.5), which loses the protection of `g(2)` with
`g := k ↦ ResidueClass(k, 4)`.

One problem found by the full suite and fixed: `hasResidueArm()` walks
through aliases, and `declareType()` asked it for every declaration; a chain
of 32 aliases with two branches per level took minutes (the walk unfolded the
same alias once per branch). The walker (`containsPrimitive()`,
`common/type/utils.ts`) now keeps the answer per alias name within one walk,
which also makes `typeContainsMissing()` linear on such a chain.

## 8. Alternatives considered

- **A flag on the operator definition** (`residueClass: true`). Smaller: it
  fixes #471 with no type change. It is a check on the head, not on the
  value, so it cannot protect a symbol declared to hold a class with no value,
  nor an application of a function value; and it leaves the admission by
  accident in place. No other system works that way. Rejected by the user
  (2026-10-23).
- **Read `expr.type` at each node.** Simple, but it computes types that
  nothing else asks for: 8 to 13% slower in an engine that uses classes
  (section 2).
- **A nominal type declared by the library** (the `type` declarations of
  `docs/TYPE-SYSTEM.md`). Membership in a nominal type is read from a runtime
  tag that a constructor stamps on an object (`docs/TYPE-SYSTEM.md`,
  "Protocols are global nominal contracts … dynamic dispatch uses the runtime
  nominal tag"); a `ResidueClass(…)` call is a function expression with no
  such tag, and the lattice rules of 4.1 (disjoint from `number`, a
  non-cell element) need a primitive. Rejected.
- **A family of types, `residue` with a modulus**, so that a signature can
  say "the same modulus only" (GAP has one family per ring). Can be added
  later on top of the primitive type; not needed for #471.

## 9. Decisions of the user (2026-10-23)

1. A type for residue classes, not a flag on the operator definition.
2. The name of the type is `residue` (not `residue_class`).
3. `Max(c, x)` and `Min(c, x)` with a class `c` are an `incompatible-type`
   error (4.7), not an unevaluated call of type `value`.
4. No rule that waits for proof of a number before it cancels: a symbol that
   holds a class is declared `residue` (4.8).

## 10. Files

- `src/common/type/primitive.ts`: the new primitive type; the predicates
  that list value types that are not cells (`cellTypeMayCarryDimensions()`).
- `src/compute-engine/library/sets.ts`: the signature of `ResidueClass` and
  the element type of `QuotientRing`.
- `src/compute-engine/library/arithmetic.ts`: the nine signatures of 4.3, the
  type handlers of 4.4, the `Max`/`Min` refusal of 4.7.
- `src/compute-engine/boxed-expression/validate.ts`: `checkNumericArgs()`
  and `nonNumericOperandError()` admit `residue`.
- `src/compute-engine/boxed-expression/residue-class.ts`: the three sources
  of evidence of 4.5, `isResidueClassOperand()`, the entry routes of the
  engine shortcut.
- `src/compute-engine/boxed-expression/boxed-function.ts`: where an engine
  joins `enginesWithClasses`.
- `src/compute-engine/engine-declarations.ts`: a declaration with a `residue`
  arm joins the engine.
- The compiled targets (`src/compute-engine/compilation/`): decline a
  `residue` input or operand (with CE-393).
- `docs/TYPE-SYSTEM.md`, `doc/08-guide-types.md`, `doc/90-reference-sets.md`,
  `doc/96-reference-number-theory.md`, `doc/06-guide-augmenting.md` (a head
  that returns classes declares `-> residue`), `CHANGELOG.md`, and the
  generated `src/api.md` (`npm run doc`) and the Epsil type listing
  (`src/epsil/docs/`), which enumerate the primitive types.
- Tests: `test/compute-engine/item-399-residue-class.test.ts` and a new test
  file for a declared head.

## 11. What the implementation changed from this plan (2026-10-23)

- **Parameter numericity.** Nine places read a declared parameter type with
  `isSubtype(param, 'number')` to decide a broadcast, the propagation of an
  absent operand, the numeric inference of a free argument, the set bar, or
  whether a mapped operator has a scalar parameter. With `residue` in the
  parameter they all answered "not numeric": `Negate(Missing)` passed the
  absent operand through instead of giving `NaN`, `Power([1, 2, 3], Set(1, 2))`
  was fanned over the list instead of refused whole, `Map(Sqrt, U)` with
  `U: any` lost its list arm. Each now reads the parameter without its
  `residue` arm (`withoutResidueArm()`, `common/type/utils.ts`):
  `signatureParamsPropagateAbsence()`, `allParamsNumeric()`,
  `unindexedOperandBroadcast()`, the set-operand refusal and the eager-source
  scan of `boxed-function.ts`, `parameterAdmitsTuple()`,
  `broadcastingCallbackElementTypeD()`, and the absent-symbol check of a
  call. The declared result types stay `number`: a declared result of
  `number | residue` made the callee test (4.5) read every arithmetic
  application as holding a class.
- **`Max` and `Min`** (4.7): typed `error` at boxing and refused at
  evaluation, not refused by a `canonical` handler.
- **A list of classes is read by its cells** (4.1): `list<residue^2>`.
- **`Equal(c, 2)`** stays unevaluated (4.7).
- **The result shape of arithmetic over a class** beside a collection is
  computed by the handlers from the sum of the operands with each class read
  as an integer cell (`residueShapedResultType()`, `library/arithmetic.ts`),
  because the arithmetic handlers are exempt from the generic broadcast lift.
- **Two readings of the type evidence.** A user function that shadows a
  library head takes its parameter type from the library signature, so with
  `Square := x ↦ x + 100` the parameter is `number | residue`. For the
  protection that is right: `x/x` must not be cancelled when `x` may be a
  class. For the compiler it is not: `Square(y)` with `y: real` must compile.
  So `containsResidueClass()` reads a type with a `residue` arm as evidence
  (the usual reading, "may be a class"), and `holdsResidueClassForCertain()`
  reads only a type that is `residue` apart from an absent or `NaN` arm (the
  strict reading); the compiler asks the strict question. The arithmetic type
  handlers make the same distinction: an operand that is certainly a class
  gives `residue`, an operand that may be one gives `number | residue`
  (`isCertainlyResidueClass()`, `library/arithmetic.ts`).
- **The compile decline** is one check at the compile boundary of
  `BaseCompiler.compile()`, with `holdsResidueClassForCertain()` as its test.
- **The error text of the arithmetic operators** names the new parameter
  type: `Sqrt("banana")` reports "expected `complex | infinity | residue`",
  where it reported `complex | infinity`. Six tests and two Epsil
  documentation examples (`src/epsil/docs/examples.md`, `from-python.md`)
  were updated to the new text.
- **Fixes applied after the dual review (2026-10-23).**
  - The admission of a class operand is an option of `checkNumericArgs()`
    (`{ residue: true }`), set by the nine admitting operators only, so that
    `Exp`, `Ln`, `Log` and `Exp2`, which share the helper, still refuse a
    class.
  - An operand typed `string | residue` (or `list<string | residue>`) is
    refused: `admitsResidueClassOperand()` (`validate.ts`) admits a type only
    when what is left after the `residue` arm is removed is numeric or empty.
  - `ce.symbol('r').type = 'residue'` registers the engine as one that holds
    classes, as `ce.declare()` does: `noteResidueDeclaration()` is called from
    the `type` setter of `BoxedSymbol`.
  - A `ResidueClass` reached through `Apply(f, …)` or `If(p, f, g)(…)` is
    found: `Apply` is read before its library definition.
  - The numeric alternative of a shaped result uses the operator's own
    derivation (`context.derive('Op', o)`), not the `Add` handler: a product of
    a class and a tuple is `tuple<residue, residue>`, `[c, d] + 1` is
    `list<residue^2>` (each class is read as an integer cell for the shape,
    `residueAsInteger()`).
  - `Max(bigRing)`, with `bigRing: set<residue>`, is typed `error` (the strict
    reading looks inside collections: `isUninhabitedWithoutResidue()`);
    `Max([c, 1])` is typed `number` at boxing and refused at evaluation.
  - `containsPrimitive()` (`common/type/utils.ts`) keeps a per-walk memo of
    the answer for each alias it unfolds. Without it, `hasResidueArm()` on a
    chain of 32 aliases took minutes (`broadcastable-list-meaning.test.ts`
    declares such chains). A first version did not keep an answer computed
    below a cut of the descent guard, which is exact, but a self-recursive arm
    at each level of the chain made that version exponential again (the
    "cases of the review of the recursive-alias fixes" block of the same
    test hung); the kept version memoizes every answer, which is sound
    because the walk joins its answers with "or" and a `true` reaches the top
    of the walk before a wrongly kept `false` can be read.
