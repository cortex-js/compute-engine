# Value kinds: one mechanism for values with their own arithmetic

**Status:** DRAFT, revision 7, 2026-10-26, after seven rounds of a dual
design review (Claude and Codex; the merged findings are in
`docs/scratch/2026-10-26-value-kinds_SPEC_REVIEW.md`; section 12 says what
each finding changed). Direction agreed with the user on 2026-10-26: one
mechanism (4.1); admission by the kind (4.2); a library user can make the
same extensions as the library (4.10); decisions A, B, C (4.1.1, 4.2, 4.3)
and D (4.7); the field is named `arithmetic`; current behavior that is
accidental or poorly justified may change for a more logical one, recorded
in section 6 (the user, 2026-10-26). Process: phase 1 starts when a review
round reports no high finding against it; phase 2 needs the inventory of
section 8 first. Not yet implemented. ROADMAP entries: CE-507 (the hook),
CE-508 (the `Quantity` and `Measurement` defects it fixes). GitHub issues:
[#477](https://github.com/cortex-js/compute-engine/issues/477) (a head typed
`residue` cannot supply its own `Add` and `Multiply`),
[#416](https://github.com/cortex-js/compute-engine/issues/416) (an interval
value, separate from the set `Interval`), and the design record of the
`residue` type, `docs/plans/2026-10-23-residue-class-type.md`.

## 1. The problem

Some values are not numbers, but take part in arithmetic with their own
rules. The engine has three of them today, and a fourth is asked for:

| Value | Example | Its arithmetic | A number rule that is wrong for it |
| --- | --- | --- | --- |
| A residue class | `ResidueClass(2, 4)` | a ring; a field only for a prime modulus | `c/c = 1` (2 has no inverse modulo 4) |
| A quantity | `Quantity(2, "m")` | addition within one dimension; a product changes the dimension; a temperature with an offset reads a difference and a sum differently | `x - x = 0` loses the unit |
| A measurement | `Measurement(2, 0.1)` | first-order error propagation; independent errors add in quadrature | `x - x = 0` (the evaluated value is `0 ± 0.141…`) |
| An interval value (#416, not in the engine) | `[0, 1]` as a value | enclosures; no additive inverse; distributivity holds only in part | `x - x = 0`, `x/x = 1`, `a(b + c) = ab + ac` |

The engine handles the three it has with three different mechanisms.

1. **A residue class is identified by its type.** `ResidueClass(k, n)` is
   typed `residue`; only the nine arithmetic operators name `residue` in a
   parameter type, so `Sin(c)` is refused at boxing. An expression is
   protected from the number rules when it holds a class
   (`containsResidueClass()`, `boxed-expression/residue-class.ts`), which
   reads a `ResidueClass` call, a symbol declared `residue`, or a callee
   declared `-> residue`. The arithmetic itself is wired to the name
   `ResidueClass`: `residueFold()`, `ringOf()`, `classOf()` and `residueOf()`
   read only that head. So a head declared `(any, any) -> residue` gets the
   protection and not the arithmetic, and has no way to supply its own: the
   `Add` and `Multiply` handlers never call it, a simplification rule is not
   reached (the residue step of `simplify()` stops first), and an `evaluate`
   handler on `Add` with `{ extend: true }` replaces the library `Add` for
   the engine (after it, `x + x + 1 + 2` gives `x + x + 3`). This is #477.
   `doc/06-guide-augmenting.md` advised that extension until phase 0.
2. **A measurement is identified by its head and typed as its nominal
   value.** `Measurement(2, 0.1)` is typed `integer`, `Measurement(2.5, 0.1)`
   is typed `real`, a complex nominal `complex`, so every numeric function
   admits it, and `measurementUnaryByHead()`
   (`library/measurement-arithmetic.ts`) propagates the error through any
   function whose derivative the engine knows. Nine handlers call it by
   name; `Add`, `Multiply`, `Divide`, `Power` and `Negate` have a branch
   each; the relational operators read the nominal through
   `measurementNominal()`; `Mean`, `Median` and the variance family
   (`library/statistics.ts`, 18 lines) recognize a list of measurements;
   `boxed-expression/compare.ts` has 36 lines for the two heads. Nothing
   protects a measurement from the number rules:
   `Measurement(2, 0.1) - Measurement(2, 0.1)` evaluates to
   `Measurement(0, 0.141…)` and simplifies to `0` (CE-508.4), and a
   function `f: (real) -> real` with the body `x/x` is `1` at its
   declaration, before any measurement reaches it (the canonical form folds
   `x/x` for a symbol typed `real` or `unknown`; measured 2026-10-26).
3. **A quantity is identified by its head and typed `value`.** `quantityAdd()`
   and `quantityMultiply()` (`library/quantity-arithmetic.ts`) are called by
   name from `Add` and `Multiply`; `quantityCompare()`
   (`library/relational-operator.ts:84`, over `compareQuantities()` in
   `quantity-compare.ts`) from the relational operators. `quantityAdd()`
   refuses a sum with a non-quantity operand, so `x + 2 m + 3 m` does not
   fold (CE-508.3); `2 m + 30 cm` evaluates to `2.3 m` but does not simplify
   (CE-508.2); and `2 m - 2 m` simplifies to the number `0` (CE-508.1).

In `library/arithmetic.ts` alone, 73 lines test one of the three names (33
for `ResidueClass`, 22 for `Measurement`, 18 for `Quantity`); the other
library files add about 90 more. Three protection stories, of which only one
is correct, and no way for an extension to add a kind of its own.

Compilation has the same three stories. A residue class is refused at the
compile boundary by an explicit type test (`base-compiler.ts`,
`holdsResidueClassForCertain()`); `Quantity` and `Measurement` are refused
because no target has a lowering for the head; the set `Interval` is refused
on `interval-js` for the same reason. All three fail closed, which is
correct; none is a mechanism an extension can use, and a user `compile`
handler on `Add` replaces it for the engine as the `evaluate` route does.

## 2. What other systems do

- **Mathematica.** A head's `UpValues` give it a say in any operation that
  has it as an operand (`Interval`, `Quantity`, `Around` all work this way),
  and the kernel keeps the number rules away from such a head because the
  head's own rules fire first. There is no separate type. `Around` compares
  by its nominal.
- **SymPy.** A class defines `__add__`, `__radd__`, `__mul__`, `__lt__`, …;
  the dispatch is by the class of the operand, and the result class decides
  the rules. The `Mod` object folds `x + 3 mod 4`.
- **Python's `fractions`, `decimal`.** The same: behavior on the class,
  recognition by `isinstance`.

In all three, the behavior is declared on the constructor of the value, and
the value's kind is read from the value itself. The engine's `residue` design
added a second reading, by declared type, because the engine must protect an
expression before it has a value (`r - r` with `r: residue` and no value).

## 3. What was measured (2026-10-26)

On `main` at `1531783ca`. The "expected" columns are the acceptance values of
this plan; "unchanged" means the expression is returned as it is. A row
marked ★ is a deliberate change of current behavior (section 6).

| Expression | `evaluate()` today | `simplify()` today | Expected `evaluate()` | Expected `simplify()` | Phase |
| --- | --- | --- | --- | --- | --- |
| `x + MyMod(2, 4) + MyMod(1, 4)`, `MyMod: (integer, integer) -> residue` with a kind | unchanged | unchanged | `x + MyMod(3, 4)` | `x + MyMod(3, 4)` | 1 |
| `MyMod(2, 4) - MyMod(2, 4)` | `Add(Negate(MyMod(2, 4)), MyMod(2, 4))` | the same | `MyMod(0, 4)` | `MyMod(0, 4)` | 1 |
| `MyMod(2, 4) + MyMod(1, 6)` | unchanged | unchanged | unchanged | unchanged | 1 |
| `MyMod(2, 4) + ResidueClass(1, 4)` | unchanged | unchanged | unchanged (two heads do not combine) | unchanged | 1 |
| `(MyMod(5, 7) + 1/3).N()` | unchanged | | `MyMod(3, 7)` (exact operands, as for `ResidueClass`) | | 1 |
| `x + ResidueClass(2, 4) + ResidueClass(1, 4)` | `x + ResidueClass(3, 4)` | the same | the same | the same | 1 |
| `x + x + ResidueClass(1, 5)` | unchanged | `2x + ResidueClass(1, 5)` | `2x + ResidueClass(1, 5)` ★ | the same | 1 |
| `(√2 + π + ResidueClass(1, 5)).N()` | `1.414… + 3.141… + c` | | `4.555… + c` ★ | | 1 |
| `r + r + ResidueClass(1, 5)`, `r: residue`, no value | unchanged | | unchanged | | 1 |
| `L + L`, `L: list<residue>`, no value | `incompatible-type` at boxing | | unchanged, typed `list<residue>` ★ (defect fix) | | 1 |
| `Equal(ResidueClass(1, 5), 2)`, `Equal(ResidueClass(1, 5), ResidueClass(1, 6))` | unchanged | | unchanged (the `eq` hook of `ResidueClass` declines) | | 1 |
| `Equal(MyMod(7, 5), MyMod(2, 5))`, `MyMod` with no `compare` and no `eq` | unchanged | | unchanged (one kind type, not `isSame`: no answer rather than a wrong `False`) | | 1 |
| `Less(ResidueClass(2, 5), ResidueClass(2, 5))`, `LessEqual` of the same | `False`, `True` | | the same (the identity shortcut) | | 1 |
| `simplify(Equal(c, c))`, `simplify(Tuple(c, sin²y + cos²y))` | | `True`, `(c, 1)` | | the same (group-2 nodes are not barred) | 1 |
| `Less(ResidueClass(1, 5), ResidueClass(2, 5))` | unchanged, typed `boolean` | | the same (no `compare`) | | 1 |
| `Max(ResidueClass(1, 5), x)` | `incompatible-type`, typed `error` | | the same | | 1 |
| `Sum(k/k, k ∈ [ResidueClass(1, 5), ResidueClass(2, 5)])` | `ResidueClass(2, 5)` | | the same | | 1 |
| `Map(x -> x/x, [ResidueClass(2, 4), ResidueClass(3, 4)])`, box and parse routes | `[c/c, ResidueClass(1, 4)]` (the stamp types `x` as `residue`; `c/c` has no inverse) | | the same | | 1 |
| the same through `ce.function('Map', [ce.box(lambda), L])` | `[1, 1]` (the body folded before the stamp; wrong) | | `[c/c, ResidueClass(1, 4)]` ★ (defect fix) | | 1 |
| `Sum([c1, c2])`, `Map(Negate, [c1, c2])`, `Reduce([c1, c2], Add)` | `ResidueClass(3, 5)`, a list of classes, `ResidueClass(3, 5)`; typed `number`, `vector<2>`, `number` | | the same values; typed `residue`, `list<residue^2>`, `residue` | | 1 |
| `GF8(1) + GF8(2)`, `GF8: (integer) -> gf8` with `gf8` a user nominal type and `admittedAs: 'none'` | refused at boxing | | `GF8(3)` | `GF8(3)` | 1 |
| `Sin(ResidueClass(2, 5))` | `incompatible-type` at boxing | | unchanged | | 1 |
| `Quantity(2, m) + Quantity(30, cm)` | `Quantity(2.3, m)` | unchanged | `Quantity(2.3, m)` | `Quantity(2.3, m)` | 2 |
| `x + Quantity(2, m) + Quantity(3, m)` | unchanged | unchanged | `x + Quantity(5, m)` | `x + Quantity(5, m)` | 2 |
| `x + y + x + Quantity(2, m) + Quantity(3, m)` | unchanged | unchanged | `2x + y + Quantity(5, m)` | `2x + y + Quantity(5, m)` | 2 |
| `Quantity(2, m) - Quantity(2, m)` | `Quantity(0, m)` | `0` | `Quantity(0, m)` | `Quantity(0, m)` | 2 |
| `Quantity(2, m) + Quantity(3, m) + Quantity(4, s) + Quantity(5, s)` | unchanged | unchanged | `Quantity(5, m) + Quantity(9, s)` | the same | 2 |
| `Quantity(6, m) · Quantity(1, 1/m) · 2` | | | `12` | `12` | 2 |
| `Quantity(6, m) / Quantity(3, m)` | `2` | | `2`; static type `number \| quantity` | | 2 |
| `q1 / q2`, `q1, q2: quantity`, no values | | | unchanged; static type `number \| quantity` | | 2 |
| `Quantity(2, m) · Measurement(3, 0.1)`, and the reverse order | `Quantity(Measurement(6, 0.2), m)` | | the same, both orders | | 2 |
| `Sqrt(Quantity(4, m^2))`, `Max(Quantity(2, m), Quantity(3, m))` | `Quantity(2, m)`, `Quantity(3, m)` | | the same | | 2 |
| `Less(Quantity(2, m), Quantity(300, cm))` | `True` | | `True`, typed `boolean` | | 2 |
| `Abs(Quantity(-2, m))` | unchanged, typed `value` | | `Quantity(2, m)`, typed `quantity` ★ | | 2 |
| `Sin(Quantity(2, m))` | valid, typed `value`, unchanged | | valid, typed `number`, unchanged (the handler finds no angle) | | 2 |
| `Sin(Quantity(2, deg))` | `Sin(π/90)` (canonical fold) | | the same | | 2 |
| `Measurement(2, 0.1) - Measurement(2, 0.1)` | `Measurement(0, 0.141…)` | `0` | `Measurement(0, 0.141…)` | `Measurement(0, 0.141…)` | 2 |
| `Less(Measurement(2, 0.1), 3)`, `Equal(Measurement(2, 0.1), 2)` | `True`, `True` | | `True`, `True`, typed `boolean` | | 2 |
| `Equal(Measurement(1, 0.1), Measurement(1, 0.5))` | `True` | | `True` | | 2 |
| `Max(Measurement(1, 0.1), Measurement(1, 0.5))` | unchanged | | `Measurement(1, 0.1)` (by nominal; a tie keeps the first) ★ | | 2 |
| `Floor(Measurement(2.5, 0.1))` | `Measurement(2, 0.1)` | | the same, typed `measurement` | | 2 |
| `Cos(Measurement(0, 0.1))`, `1 ^ Measurement(2, 0.1)` | `1`, `1` | | `Measurement(1, 0)`, `Measurement(1, 0)` ★ | | 2 |
| `Negate(u)`, `u: real \| measurement`, no value | | | static type `real \| measurement` | | 2 |
| `Divide(u, 2)`, `u: integer \| measurement`, no value | | | static type `rational \| measurement` (the operator's own result over `integer`) | | 2 |
| `Factorial(Measurement(5, 0.1))` | `Measurement(120, 20.47…)` | | the same (`Factorial` is `(complex \| infinity) -> number`) | | 2 |
| `Mean([Measurement(4, 0.1), Measurement(6, 0.1)])` | `Measurement(5, 0.0707…)` | | the same, through `apply` | | 2 |
| `GCD(Measurement(4, 0.1), 6)` | valid (`GCD: (any*)`), typed `integer`, unchanged | | valid, typed `integer`, unchanged (group 2: the handler runs and declines) | | 2 |
| `Floor(Measurement(2 + 3i, 0.1))` | `incompatible-type` at boxing (the nominal types the call `complex`) | | `incompatible-type` at evaluation, from `apply` (decision D) ★ | | 2 |
| `Sin(M)^2 + Cos(M)^2`, `M` a measurement | | `1` (wrong: the two errors are not independent) | | unchanged | 2 |
| `f(x) := x - x`, `f: (real) -> real`, then `f(Measurement(2, 0.1))` | `0` (`x - x` by substitution; `x/x` would be `1`, folded at declaration) | | `incompatible-type` at the call (decision B) ★ | | 2 |
| `g(x) := x - x`, `g: (real \| measurement) -> real \| measurement`, then `g(Measurement(2, 0.1))` | | | `Measurement(0, 0.141…)` | | 2 |
| `Map(x -> 2x, [Measurement(2, 0.1), Measurement(3, 0.1)])` | `[Measurement(4, 0.2), Measurement(6, 0.2)]` | | the same (an `unknown` parameter admits a kind) | | 2 |
| `ResidueClass(2, 5) + Quantity(3, m)` | unchanged, typed `list<list<any> \| residue> \| residue` | | unchanged, typed `quantity \| residue` | | 2 |
| `ce.declare('Add', { evaluate: () => undefined }, { extend: true })`, then `x + x + 1 + 2` | `x + x + 3` (was `2x + 3`) | `x + x + 3` | not a route this plan offers; the guide stopped advising it (phase 0, done) | | 0 |

Compilation (`compile(expr, { to })`): `x + Quantity(2, m)`,
`x + Measurement(2, 0.1)`, `Sin(Measurement(2, 0.1))`, `x + ResidueClass(2, 5)`
and `x + MyMod(2, 5)` all decline on `javascript`; `x + Interval(0, 1)`
declines on `interval-js`; `Sin(Quantity(2, deg))` compiles only because
canonicalization folds it to a number first. Expected: the same declines,
with one message that names the kind's type, for the residue heads after
phase 1 and for `Quantity` and `Measurement` after phase 2.

## 4. The design

### 4.1 One mechanism: behavior on the head, recognition by its type

A **value kind** is declared on the operator definition of the head that
constructs its values. The rule, agreed on 2026-10-26:

> A head that declares a value kind must declare a result type that is a
> **kind type**: a type that is disjoint from every number type and is not a
> top type (section 4.1.1). The engine collects the kind types of the heads
> that declare a kind. An expression is **recognized** as holding a kind
> value when its declared type, its callee's declared result type, or the
> type of its symbol's value has an arm among those types, or when it holds
> a call of such a head at any depth. A **value** (an evaluated operand)
> dispatches to the kind of its head.

The two readings answer two different questions and cannot be merged into
one:

- **Dispatch needs the head.** A value is a call; its head names a
  definition; a definition holds behavior. A type holds no behavior, and two
  heads can share a type (`ResidueClass` and `MyMod` are both `residue`,
  with different rules for their moduli).
- **Recognition needs the type.** `r - r` with `r: residue` and no value,
  and `g(2)/g(2)` with `g: (integer) -> residue`, must not become `0` and
  `1`. There is no head to read; only the declared type says what the value
  will be. The `residue` design moved recognition to the type for this
  reason, and the head-only reading was the defect of #471.

Three things are declared PER TYPE, because a free symbol of the type has
no head to ask: the admission (`admittedAs`, 4.2), the static result typing
(`resultType`, 4.5) and the compiled representation (`compile.type`, 4.8).
They are given through the `arithmetic` field of any head of the type and
stored under the type; the heads of one type must agree on them (4.1.2).
Everything else (the hooks) is per head.

#### 4.1.1 Kind types: a kind primitive or a nominal type

A kind type is one of:

- **A kind primitive**: a name in the type language itself, in `VALUE_TYPES`
  of `src/common/type/primitive.ts` with an entry in the subtype table of
  `subtype.ts` that lists no subtypes and no supertype but `value` (`residue`
  is one: `subtype.ts:164`). It exists before any engine, in every engine
  and in every type string, so a library signature can name it. Only the
  library can add one. The kind primitives of this plan: `residue` (exists),
  `measurement`, `quantity` (phase 2), and the interval value's type
  (phase 3).
- **A nominal type whose definition is exactly `value`**, declared with
  `ce.declareType(name, 'value', { mint: false })`: a record in the
  engine-level type registry (one namespace per engine, not lexically
  scoped; `engine-declarations.ts:1026`). This is the form a library user
  declares.

**A kind type is a subtype of `value` and of `expression`** (decision A,
2026-10-26). A primitive is, by its table entry. A nominal type is opaque
today ("deliberately not a subtype of its definition", `subtype.ts:2811`;
measured 2026-10-26: `ce.declareType('uk1', 'value')` gives a type that
matches `any` but neither `value` nor `expression`, and
`ce.assign(s, uk1Head(1, 2))` for `s: value` throws). The one exception is
the rule that makes `Person <: object` hold by reading the definition
(`subtype.ts:3924`). This plan adds the same rule for `value`: a nominal
type whose definition is exactly `value` is a subtype of `value` and of
`expression`, read from the definition, independent of any registration or
declaration order. So a `value`, `any` or `expression` parameter admits it
(`List`, `Hold`, `Equal`, an assignment to a `value` symbol).

**A kind type is disjoint from every other type** but `value`,
`expression`, `any`, `unknown` and itself. A primitive is, by its table
entry (`residue: []`, and the comment there: the disjointness is what keeps
the number rules away from a class). A nominal type is NOT today:
`provablyDisjointRules()` (`subtype.ts:797`) unfolds a nominal reference to
its definition, and `value` overlaps `number`, `string` and the collections
(measured 2026-10-26: a nominal `gf8 = value` is not provably disjoint from
`number`, so `Fact.CouldBeNumber` holds for a `gf8` symbol). This plan adds
the disjointness rule beside the subtype rule: a nominal type defined as
exactly `value` is disjoint from every type except those five, exactly as
the `residue` entry is. Both rules read the definition, so they hold before
any head is declared and do not depend on the registry. A nominal type with
another definition (`gf8 = integer`) is refused as a kind type (4.1.2): it
would be a subtype of its definition's supertypes through the `object` rule
and not disjoint from `number`.

The engine does not treat the two forms differently anywhere in this plan:
the dispatch, the recognition, the admission, the registry and the compile
contract read "a kind type" and never "a primitive". The library kinds are
primitives because library signatures are parsed before any engine exists,
not because a primitive can do more (section 4.10).

A nominal type mints a constructor of its own name in the global scope
(`point(1, 2)` for `type point`). A user kind has its own head as the
constructor (`CenteredInterval(c, r)`, typed `cinterval`), so the declaration
of its type must not mint one. `declareType()` has an internal option
`mint: false` ("no caller uses it today", `engine-declarations.ts:1022`);
phase 1 makes it public, documented as the option a value kind uses. This
changes decision D5 of the nominal-types design ("a type declaration claims
both namespaces", `engine-declarations.ts:1019`), and the change is recorded
in that design's record. A kind registration on a nominal type that minted
a constructor (declared with the default `mint: true`) is refused: the
minted constructor would be a second head of the kind type with no hooks.

A type declaration that REPLACES the definition of a registered kind type
(a later `DeclareType` in an Epsil batch, `docs/TYPE-SYSTEM.md`) with
anything but a nominal definition of exactly `value`, that turns it into a
transparent alias, or that would mint a constructor for it, is refused at
the type-declaration funnel, so that the subtype and disjointness rules
above keep holding for a registered kind; tested across a batch, a rollback
and a checkpoint restore. In phase 1 a kind type is a plain nominal name:
a parameterized nominal type (`gf<7>`) and a nominal type defined as
another nominal kind type (`type h = gf8`) are refused as kind types, with
an error that says so; their rules can be added later without changing the
mechanism.

#### 4.1.2 The declaration check

At `ce.declare(head, { signature, arithmetic })`, the engine checks the
result type of every arm of the signature:

- accepted: a kind primitive, a nominal type whose definition is exactly
  `value`, or a union of them, each arm with at most the marker arms `nan`,
  `missing`, `nothing`, `error` added by the engine's own result typing;
- refused, with an error that names the rule: any other arm — a number type
  (`integer`, `real`, `complex`, `number`, a ranged or literal number type),
  `boolean`, `string`, `expression`, `symbol`, `function`, a collection type
  (`list<…>`, `tuple<…>`, `set<…>`, …), a top type (`value`, `any`,
  `unknown`), a nominal type with another definition, and a structural
  alias that expands to one of these. So `-> residue | integer` is refused:
  recognition by that type would protect every integer.

A head that declares `add` must declare `negate`: `a - b` is canonically
`Add(Negate(b), a)`, so without it a difference never folds.

**The per-type declarations** (`admittedAs`, `resultType`, `compile.type`)
are stored under the kind type. The first head of a type to supply a field
sets it; another head of the same type that is LIVE AT THE SAME TIME must
leave the field absent (then it is inherited) or supply an equal one: value
equality for `admittedAs` (absent means `'none'`), reference identity for
the function-valued fields (two closures with the same logic are refused;
the author shares one function). A head is LIVE while its definition is in
the dispatch part of the registry (4.6), which includes a popped definition
whose values may still exist. A redeclaration of the same binding
(`{ extend: true }`, a notebook cell run again, an Epsil statement run
again in a later batch), or a declaration made when no live head of the
type remains, REPLACES the per-type fields and increments the generation
counter (4.6) ONLY when no other head of the type is live; when another
head is live, the redeclaration must supply equal fields or none, because a
replaced `compile.type` would leave the other head's `compile.value` on
the old representation (4.8). A head may not add a field that a LIBRARY head's type left
absent: `MyMod` cannot give `residue` a `compile.type`, because that would
set the lowering of every free `r: residue` and of `ResidueClass`
arithmetic. The fields stay under the type when the head that supplied them
is removed (4.6).

### 4.2 Admission: where a kind's values are accepted

Recognition by type means every kind has a type of its own, so an operator
must be told that it accepts the kind. Three options were considered
(decision 2 of the 2026-10-26 discussion):

- (i) every signature names each kind, as the nine arithmetic operators name
  `residue`: does not scale to the hundreds of numeric functions;
- (ii) **the kind says which parameter types admit its values** (chosen);
- (iii) the kind is typed as a number, as `Measurement` is today: `Sin(I)`
  works, but nothing can protect `I - I`.

A kind's values are admitted at three groups of parameters.

**1. By rule, for every kind: the arithmetic operators.** The operand check
of `Add`, `Multiply`, `Negate`, `Subtract`, `Divide`, `Power`, `Sqrt`,
`Root`, `Square` admits every registered kind type for which ANY registered
head of the type declares the matching hook (`add` for `Add` and `Subtract`,
`multiply` for `Multiply`, `negate`, `divide`, `power` for the rest)
(decision A), the kind type itself and ELEMENT-WISE inside a collection or
tensor type (`list<gf8>`, `tuple<residue, residue>`), as the carrier rule
of group 3 is. The check is the generalized `admitsResidueClassOperand()`
(`validate.ts:204`): remove the absence arms of the argument's type, remove
the arms that are admitted kind types, and require what remains to be
`never` or a subtype of `number`, element-wise in a collection type; so
`integer | gf8`, `gf8 | missing` and `list<integer | gf8>` are admitted and
`string | gf8` is refused, as `integer | residue` and `string | residue` are
today. The same rule runs in `numericOperandTypeRefused()` on the type-only
route (below). This replaces the literal `residue` in those signatures
(`Add: ((number | residue)*) -> number` today, `arithmetic.ts:9671`): the
signatures keep their number parameters, and the check reads the registry
at boxing (an expression refused before the hook was registered is not
revisited). So a user nominal kind with `admittedAs: 'none'` (`gf8`) reaches
`Add` without a change to any library signature, which is what the parity
rule of 4.10 requires; and a declared `L: list<residue>`, refused at every
arithmetic operator today (`L + L` is an `incompatible-type` error at
boxing, measured 2026-10-26, while a literal list of classes works), is
admitted and broadcast (section 6). `Max` and `Min` are `(value*)` and the six relational
operators are `(any, any*)`, so they admit every kind type through group 2;
what they DO with a kind value is decided by `compare` (4.4).

**2. By type, for every kind: parameters that name the kind's type or admit
`value`.** A parameter typed `residue`, `value`, `any` or `expression` admits
a kind value directly, through subtyping (4.1.1): `List`, `Hold`, `Equal`,
`IsMissing`, `Assign`, `GCD` (`(any*)`), `Max`, the relational operators, and
every lazy or structural operator. These operators run their own handlers,
which see the value as a value; a numeric handler that cannot read a kind
value leaves the expression unevaluated, as `GCD(4 ± 0.1, 6)` is today.

**3. By `admittedAs`: parameters that admit a number.** The kind type
declares `admittedAs`, one of:

- `'none'` (the default): no further admission. A residue class is a
  `'none'` kind by the decision of 2026-10-23: a class is an element of a
  finite ring with no order and no embedding into the reals, so `Sin(c)`,
  `Floor(c)` and `c < d` have no meaning, and admitting it as an integer
  would also let `c` reach integer code (`Factorial`, `GCD`) that computes
  a wrong number from the representative. `Sin(c)` was admitted and stayed
  unevaluated before that decision, and the refusal at boxing is listed in
  the `CHANGELOG.md` entry for #471 as the fix. A quantity is `'none'` too:
  it has a dimension, and only the operators that know what to do with one
  name `quantity` (4.7).
- `'real'`: admitted at every parameter `P` of an operator such that
  `isSubtype('real', P)` after the absence arms of `P` are removed, lazy or
  not, with or without a handler. ADMISSION and APPLY-SITE STATUS are two
  rules: only a non-lazy operator with an `evaluate` handler is an apply
  site (4.3). A lazy operator (`Choose(boolean, real, real)`,
  `control-structures.ts:285`; a binder; `Hold`) owns the evaluation of its
  operands, so it admits the value and its handler runs and sees the kind
  value as a value, as a group-2 operator does, and an unselected operand's
  side effects do not run (`Choose(True, U, Random())` is `U`). A head over
  `real` with no handler admits the value and leaves the call unevaluated.
  An arithmetic operator used as a FUNCTION VALUE (`Map(Negate, L)`,
  `Reduce(L, Add)`, `Apply(Add, c1, c2)`) is admitted by a callback check
  that reads the group-1 rule, not the literal signature. When an operator has several arms, an
  arm that admits the kind BY TYPE (`(real | umeasurement) -> …`) is chosen
  over an arm that admits it only through the carrier (`(real) -> …`), even
  when the specificity rule of `boxed-expression/overload.ts` would prefer
  the narrower `real`; the apply eligibility and the result type come from
  the chosen arm, on boxing and on the type-only route alike. So `real`, `number`, `complex`, `complex | infinity` admit it
  (`value` and `any` admit it already, through group 2); `integer` and a
  ranged number type do not. An interval
  value is admitted this way: `Sin([0, 1])` is meaningful. `finite_real` is
  a retired alias of `real` and admits it (ARCHITECTURE.md, "Non-finite
  typing convention").
- `'number'`: admitted at every parameter that admits `number`, AND at
  every parameter that admits `real` (decision D, 2026-10-26). For a kind
  whose values may be complex: a measurement (a complex nominal exists
  today, `Measurement(Complex(2, 3), 0.14)`, `measurement.test.ts:730`), a
  `CenteredInterval` (#416). The kind's `apply` is responsible for a value
  that a real-only operator cannot take: `Floor(Measurement(2 + 3i, 0.1))`
  is admitted at boxing and `apply` answers `incompatible-type` at
  evaluation (today the nominal types the call `complex` and the refusal is
  at boxing: a visible change, section 6). The alternative, two kind types
  chosen by the nominal, was rejected: it doubles the declarations and the
  type strings for one error's timing.

The carrier type is what the kind stands in for. The operand check
substitutes, for every kind arm of the ARGUMENT's type, the NARROWEST
carrier the parameter admits: `real` when the parameter admits `real` (for
a `'real'` or a `'number'` kind), else `number` (for a `'number'` kind),
element-wise inside a collection type; then it checks the whole type
against the parameter as usual. So `measurement` (a `'number'` kind) at
`real` passes as `real`, at `complex` passes as `number`, at `integer` is
refused; `string | measurement` at `real` is refused because its `string`
arm is (the rule `admitsResidueClassOperand()` in
`boxed-expression/validate.ts:201` applies today to `string | residue`); and
`list<measurement>` at `list<real>` passes through the element rule (and
then dispatches, 4.4). An operand admitted this way, and not through group
1 or 2, is what makes an operator an `apply` site (4.3).

Admission is not subtyping. `isSubtype('measurement', 'real')` is `false`;
inference does not read a measurement as a real, `measurement | real` is a
union, and a symbol declared `real`, `number` or `integer` refuses a
measurement. Admission is a rule of the operand check only
(`checkNumericArgs()`, `nonNumericOperandError()` in `validate.ts`, the
signature check of `boxed-operator-definition.ts`, and the type-only route
`deriveApplicationType()` in `boxed-expression/derive-application-type.ts`,
which types a mapping body from operand types alone: its table
`NUMERIC_OPERAND_CHECK` marks the nine arithmetic operators `'residue'` and
calls `numericOperandTypeRefused(t, admitsResidue)`; that entry becomes the
registry read of group 1, and the carrier substitution runs on this route
too, so that boxing and the type-only route agree). The type handler of the
operator then sees an operand typed by the kind, and the result type
follows 4.5.

**A function with a body admits a kind only when its parameter admits it by
type** (decision B, 2026-10-26). A "function with a body" is a definition
whose value is a `Function` expression (a `ce.declare` with a MathJSON or
LaTeX body, an Epsil function, a lambda literal, a function-typed symbol
assigned a lambda), as opposed to an operator with an `evaluate` handler.
Group 3 applies to handlers, which receive the value and can hand it to the
kind's `apply`. A body is canonicalized at its declaration with its
parameter's declared type, and the canonical form already folds `x/x` to
`1` for a symbol typed `real` or left untyped (`unknown`) (measured
2026-10-26; ARCHITECTURE.md, "Generic-symbol conventions at
canonicalization"; the 2026-10-23 plan §4.8 and CLAUDE.md: a symbol typed
`value` or left undeclared is read as a possible number, `w/w` is `1`). So:

- a parameter typed with a number type (`real`, `integer`, `number`, …)
  refuses a kind value at the call: `f(Measurement(2, 0.1))` for
  `f: (real) -> real` is an `incompatible-type` error (section 6);
- a parameter typed `unknown` (an untyped lambda), `value`, `any` or with
  the kind's type admits it (group 2); the body of a lambda whose parameter
  is `unknown`, `value` or `any` may have folded `x/x` to `1` (measured
  2026-10-26: `v/v` with `v: value` boxes to `1`), which is the documented
  reading of a symbol that may be a number, and a lambda meant for kind
  values types its parameter
  (`(real | measurement) -> …`), which makes the body hold a possibly-kind
  symbol: recognized (4.6), it keeps `x/x` and `x - x`, and the substituted
  value reaches the hooks through the operations inside the body;
- the bound variable of a binder (`Sum`, `Map`, `Integrate`) over a
  collection of kind values is typed by the element type, which names the
  kind, so a binder body is recognized (`Sum(k/k, k ∈ [c1, c2])` gives
  `ResidueClass(2, 5)` today and keeps doing so). The contextual element
  stamp (`ADMISSIBLE_ELEMENT_PRIMITIVES` in `box.ts:2646`) reads a
  registered kind type, so `Map(x ↦ x/x, [GF8(1), GF8(2)])` keeps `x/x`
  as it does for classes (today the stamp lists `residue` only and the
  `GF8` body folds to `1`). A PRE-BOXED untyped lambda passed to a binder
  over kind values (`ce.function('Map', [ce.box(lambda), L])`) is
  canonicalized again with the stamped element type, so the three routes
  agree: today that route folds the body first and gives `[1, 1]` for
  `[ResidueClass(2, 4), …]`, a wrong value (section 6).

### 4.3 The definition field

```ts
interface ArithmeticDefinition {
  /** PER TYPE. Where a value of this kind is admitted beyond the arithmetic
   * operators and the parameters that name its type or admit `value`.
   * Default `'none'`. Section 4.2. */
  admittedAs?: 'none' | 'real' | 'number';

  /**
   * The sum (product) of the operands of which at least one is a value of
   * this kind. `ops` are the evaluated operands. A fold names the operands
   * it combined, by their index in `ops`, and the value they make; a hook
   * may return several folds (one per modulus, one per dimension) and must
   * not name an operand twice. A fold may name an operand of ANOTHER kind
   * only to absorb it into its own value (a quantity takes a measurement as
   * its magnitude: `Quantity(2, m) · Measurement(3, 0.1)` is
   * `Quantity(Measurement(6, 0.2), m)`). A fold's `value` may be a value of
   * another kind or a plain number (a dimensionless product). `undefined`,
   * or an empty list, folds nothing. Section 4.4.
   */
  add?(ops: KindOperands, context: ArithmeticContext): ReadonlyArray<KindFold> | undefined;
  multiply?(ops: KindOperands, context: ArithmeticContext): ReadonlyArray<KindFold> | undefined;

  /** `-x`; `a / b`; `base ^ exponent`. `undefined` declines: the next kind
   * among the operands is asked (4.4), and when none answers the
   * expression stays as it is. For `divide` and `power`, at least one
   * operand is of this kind. `Sqrt(x)` calls `power` with the exponent
   * `1/2`, `Root(x, n)` with `1/n`, `Square(x)` with `2`; a hook that does
   * not define the result for an exponent returns `undefined`. */
  negate?(x: KindOperand, context: ArithmeticContext): Expression | undefined;
  divide?(a: KindOperand, b: KindOperand, context: ArithmeticContext): Expression | undefined;
  power?(base: KindOperand, exponent: KindOperand, context: ArithmeticContext): Expression | undefined;

  /**
   * The order of two values of which at least one is of this kind, for
   * `Equal`, `NotEqual`, `Less`, `LessEqual`, `Greater`, `GreaterEqual`,
   * `Max`, `Min`, `Sort`, `Clamp` and the methods `isEqual()`, `isLess()`,
   * …: `-1`, `0`, `1`, or `undefined` when the two are not comparable (a
   * quantity of another dimension, a value of another kind, a symbol),
   * which leaves an ORDER comparison unevaluated; for `Equal`/`NotEqual`
   * an `undefined` falls through to the head's `eq` hook (4.4), so a kind
   * whose values can be unequal without an order declares `eq` beside
   * `compare` (the quantity kind's `eq` decides that `2 m` and `2 s` are
   * not equal). ONE order serves every use: a
   * measurement compares its nominal (with the engine tolerance for
   * floats, as numbers do), so `Equal(1 ± 0.1, 1 ± 0.5)` is `True` and
   * `Max` of the two is the first (section 6); a quantity compares after
   * conversion. A kind without `compare` has no order: a relational
   * operator with its value stays unevaluated, typed `boolean`
   * (`Less(c1, c2)` for classes, as today), and `Max`/`Min` type the call
   * `error` and answer `incompatible-type` (`residueExtremumError()` and
   * `processMinMaxItem()` in `arithmetic.ts`, generalized). `Equal` of two
   * values of a kind without `compare` uses the operator's `eq` rule, as
   * today (`Equal(c, c)` is `True` by structure).
   */
  compare?(a: KindOperand, b: KindOperand, context: ArithmeticContext): -1 | 0 | 1 | undefined;

  /**
   * An operator that is an APPLY SITE for this kind: at least one operand
   * that is a value of this kind was admitted ONLY through the carrier
   * substitution of `admittedAs` (4.2, group 3): its parameter is not
   * `value`, `any`, `expression`, `unknown` or the kind's type. `Sin`,
   * `Abs`, `Floor`, `Factorial`, a user operator declared over `real` with
   * a handler; these are threadable, so a collection operand is mapped
   * first, as the generic broadcast does today (`Sin([M1, M2])` is a list
   * of measurements), and `apply` is called per element on scalars. An
   * operator whose PARAMETER is a collection type (`Mean`, `Median`, the
   * variance family, `(list<real>) -> …`) is an apply site when the
   * elements of the collection include a value of this kind; it receives
   * the collection and `ops.elements(i)`. Never an apply site: the operators of
   * group 1, the comparisons, `Max`, `Min`, `Sort`, `Clamp` (they use
   * `compare`), and every operator whose kind operands all came through
   * group 2 (`GCD (any*)`, `List`, `Hold`). An operator with kind operands
   * at both a group-2 and a group-3 parameter is an apply site.
   * Called in place of the operator's own `evaluate` handler. `undefined`
   * leaves the expression unevaluated. An `Error` expression is the result
   * (a complex measurement at `Floor`). When the kind declares no `apply`,
   * the operator's own handler runs and sees the value as it is, and the
   * call is typed by the operator's ordinary result with the carrier in
   * place of the kind (4.5, rule 5). The numeric property queries on a
   * kind value (`isPositive`, `sgn`, `isInteger`, `isFinite`, `re`, …)
   * answer `undefined`, so a canonical fold that reads them does not fire
   * and only `apply` decides. An operator that handles a kind itself names
   * the kind type in its parameter (group 2), and `apply` is not called
   * for it. Not called at a lazy operator (4.2), nor at a function with a
   * body (4.2, decision B). Section 4.4.
   */
  apply?(operator: string, ops: KindOperands, context: ArithmeticContext): Expression | undefined;

  /**
   * PER TYPE. The static CELL result type of an operator with an operand
   * of this kind's type, from the operand types with their shapes removed
   * (a `list<quantity^2>` operand is seen as `quantity`), or `undefined`
   * for the default of 4.5. The engine derives the broadcast shape itself
   * and puts this cell type in the cells (4.5). `operator` is the
   * dispatched operator: `'Power'` for `Sqrt`, `Root` and `Square`, with
   * the implied exponent type among `operandTypes`. A kind whose `divide`,
   * `multiply` or `power` can give a plain number answers `<kind> | number`
   * here for those operators.
   */
  resultType?(operator: string, operandTypes: ReadonlyArray<Type>): Type | undefined;

  /** The compiled form of the kind. Absent: every target declines an
   * expression that holds a value of the kind. Section 4.8. */
  compile?: ArithmeticCompile;
}

/** The operands of a hook. `evaluated[i]` is the value; `written[i]` is
 * the operand as it was written before evaluation (`undefined` for a value
 * that an earlier fold made, which has no written form): a kind whose rule
 * depends on how a term was written reads it there (a temperature with an
 * offset reads `Negate(b)` in `a - b`). `exact(i)` is the exact value of
 * operand `i`: `evaluated[i]` outside `.N()`; under `.N()`, the operand
 * evaluated again without the numeric approximation when it is transitively
 * pure (the rule of `exactOperands()` in `library/arithmetic.ts`, which
 * never runs a side effect twice), else `evaluated[i]`. The result is
 * memoized. A class reads `exact(i)` so that `(c + 1/3).N()` is a class and
 * not a sum with `0.333…`; the `Floor` family reads it so that a jump is
 * decided on the exact nominal (the exactness contract, CLAUDE.md). */
interface KindOperands {
  readonly evaluated: ReadonlyArray<Expression>;
  readonly written: ReadonlyArray<Expression | undefined>;
  exact(i: number): Expression;
  /** At an apply site whose parameter is a collection type, the elements
   * of collection operand `i`, enumerated ONCE by the dispatch when it
   * looked for a kind value (a lazy collection's callbacks run once);
   * `undefined` for an operand that is not a collection, or that was not
   * enumerated (4.4: a collection larger than `engine.maxCollectionSize`,
   * of unknown or infinite count, or whose element type is provably
   * kind-free). The operator's own handler, when it runs instead, receives
   * the same snapshot through the dispatch. */
  elements(i: number): ReadonlyArray<Expression> | undefined;
}
type KindOperand = { readonly evaluated: Expression; readonly written: Expression | undefined; exact(): Expression };

interface KindFold { readonly value: Expression; readonly operands: ReadonlyArray<number>; }

interface ArithmeticContext {
  readonly engine: ComputeEngine;
  /** `true` under `.N()`. The hook numericizes its own result: a kind whose
   * values are exact (a class) computes the exact value anyway; a kind
   * whose values carry a float (a measurement, an interval) returns the
   * numeric form. The caller does not apply `.N()` to the result. */
  readonly numericApproximation: boolean;
}
```

The field is `arithmetic` on `OperatorDefinition` (the user's choice,
2026-10-26; `valueKind` was judged vague), beside `collection` and
`compile`, which are the precedents for behavior declared on a definition.

```ts
ce.declare('MyMod', {
  signature: '(integer, integer) -> residue',
  arithmetic: {
    add: (ops, { engine }) => { /* group the MyMod operands and the exact integer literals by modulus; one fold per modulus */ },
    multiply: …,
    negate: …,
  },
});
```

Rules for a hook, documented with the field:

- The operands of `add` and `multiply` arrive in CANONICAL order (the
  canonical form sorts a sum and a product), and `written[i]` is aligned
  with them; `multiply` must commute. A kind whose product does not commute
  (quaternions, matrices over a finite field) is out of scope of this plan:
  it needs an unsorted product, which the canonical form does not keep.

- A hook may build and evaluate expressions through the engine
  (`engine.function('Add', […]).evaluate()`), including sums of another
  kind (a quantity whose magnitude is a measurement). The dispatch is
  re-entrant: the nested evaluation runs the other kind's hook. A hook never
  calls `.simplify()` (the recursion rule of CLAUDE.md, "Simplification and
  Recursion Prevention").
- A hook that throws propagates the error as an `evaluate` handler's error
  does.
- A fold that names an index out of range or twice is an error in the
  kind's definition and throws.

### 4.4 Dispatch

**`Add` and `Multiply`.** The handlers (`library/arithmetic.ts`, today the
`residueOperands()`, `quantityAdd()` and `measurementAdd()` branches, in
that order) become one step:

1. Evaluate the operands as today. The `NaN`, absence, point and collection
   rules of the handler run first and are unchanged; a collection operand is
   broadcast and each element sum comes back here, as for residue today.
2. Find the kinds among the evaluated operands, by the head of each value,
   in order of first occurrence. An operand that holds a kind by the
   NON-STRICT recognition of 4.6 but is not a value (a valueless symbol
   `r: residue`, `x: real | umeasurement`, an unevaluated `g(2)` with
   `g: … -> residue`) belongs to no kind's hook; it is kept beside the kind
   values in step 4 and never joins the numeric sub-sum (`r + r + c` stays
   as written: for a measurement kind `x + x` is not `2x`, because the two
   errors are independent).
3. One pass over the kinds, in that order. Each kind's `add` (`multiply`)
   receives the operands that are left: the original operands not yet
   folded, and the values made by the folds of the kinds before it (with
   `written[i]` undefined). Its folds replace the operands they name. A
   fold's value of a kind not in the list of step 2 is placed in the result
   without another pass. Precedence between kinds is this order: in
   `Measurement(3, 0.1) · Quantity(2, m)` the measurement kind is asked
   first, folds nothing (one measurement, and it does not absorb a
   quantity), and the quantity kind then absorbs the measurement; the
   result is the same in both orders (section 3).
4. The operands that remain and hold no kind (by the non-strict
   recognition), and every fold value that is a plain number, go through
   the ordinary numeric sum (product) as one sub-sum:
   `x + y + x + 2 m + 3 m` is `2x + y + 5 m`; `6 m · (1/m) · 2` is `12`.
   The operands that hold a kind (a fold's value, an operand no hook
   folded, a valueless symbol of a kind type) are placed beside it, in
   their order, with no other fold: no like terms with a kind value, no
   reciprocal cancels against one, a zero or an infinity does not absorb
   one. The sub-sum runs whether or not a hook folded anything. This is a
   deliberate change for residue classes (section 6): today the residue
   handler keeps the kind-free remainder unsummed (`x + x + c` evaluates
   as written and `(√2 + π + c).N()` leaves the two floats unadded, measured
   2026-10-26) only because it has no sub-sum step; `simplify()` already
   folds it to `2x + c`, and the quantity rows need the sub-sum.
5. Termination: one pass; a kind is not asked again after another kind's
   fold. A hook that wants a fixpoint over its own groups returns all its
   folds in one answer.

**`Negate`, `Divide`, `Power`, `Sqrt`, `Root`, `Square`.** The kinds of the
operands are listed in order of first occurrence; the first kind whose hook
(`negate`, `divide`, `power`) answers wins; `undefined` passes to the next
kind; when none answers, the expression stays as it is. `Subtract(a, b)` is
canonically an `Add` with a `Negate(b)` operand (`a - b` boxes to
`Add(a, Negate(b))`, measured 2026-10-26; the index of the negated operand
follows the canonical order, so a hook searches `written` for a `Negate`
and does not assume a position), which is how a temperature with an offset
tells a difference from a sum.

**Comparisons.** The six relational operators (lazy, `(any, any*)`), `Max`,
`Min`, `Sort`, `Clamp`, and the comparison methods (`isEqual()`, `isLess()`,
`isGreater()`, …, `exactOrder()` in `boxed-expression/compare.ts`, where
`Quantity` and `Measurement` are named 36 times today) all go through ONE
dispatch, and none of them is an `apply` site. The identity shortcut runs
first, for every kind, as today: `a < a` is `False` and `a ≤ a` is `True`
when the two operands are the same expression (`Less(c, c)` is `False`,
`LessEqual(c, c)` is `True`, measured 2026-10-26). Then, for a PAIR of
evaluated operands of which at least one is a value of a kind that
declares `compare`, the kinds are asked in order of first occurrence and
the first answer decides; `undefined` from every kind means "not
comparable". Then:

- an order operator (`Less`, …) with a chain of operands compares each
  adjacent pair and is decided only when every pair is; a pair that is not
  comparable leaves the whole comparison unevaluated (the methods answer
  `undefined`);
- `Equal` and `NotEqual` on a pair with a kind value decide in this order:
  `compare === 0` when a kind declares `compare` and it answers
  (`Equal(2 ± 0.1, 2)` is `True`, as today); else the `eq` hooks of the
  two operands' head DEFINITIONS, asked in operand order, an `undefined`
  from any `eq` that exists being final (`ResidueClass` has one in
  `library/sets.ts`, and `Equal(c, 2)`, `Equal(ResidueClass(1, 5),
  ResidueClass(1, 6))` and `Equal(MyMod(2, 5), ResidueClass(2, 5))` in both
  orders stay unevaluated, as today); else, when no head has an `eq`: two
  values whose types are provably DISJOINT are not equal
  (`Equal(2 ± 0.1, "abc")`, `Equal(GF8(1), "abc")` are `False`;
  `Equal(2 m, 2 s)` is `False` through the quantity kind's `eq`, since both
  are `quantity`), and two
  values of ONE kind type are `True` when `isSame` and otherwise stay
  unevaluated (`Equal(MyMod(7, 5), MyMod(2, 5))` stays unevaluated: the two
  are equal in ℤ/5ℤ, and a `False` would be a wrong value). A head that
  declares both `eq` and `compare` is asked `compare` first;
- `Max`/`Min` over their operands or over a collection compare pairwise and
  return the chosen operand with its uncertainty; a tie keeps the first; a
  pair that is not comparable leaves the call unevaluated;
- `Sort` stays unevaluated when any pair is not comparable;
- `Clamp(x, lo, hi)` returns `x` or the bound AS WRITTEN (`Clamp(5 ± 0.1,
  0, 3)` is `3`, as today);
- `Sort` with a value of a kind that declares no `compare` stays
  unevaluated (`Sort([c1, c2])` today, measured 2026-10-26); a `Sort` with
  an explicit `order` callback runs that callback and needs no `compare`;
  `Clamp` admits a `'none'` kind that has `compare` by the group-1 rule
  (its parameter is `real | signed_infinity`), and with a kind that has no
  `compare` types the call `error`, as `Max`/`Min` do.

A kind without `compare`: 4.3. `evaluateAsync` goes the same way. `.is()`
(`abstract-boxed-expression.ts:1066`, which today compares two non-numbers
by `isSame` only when both are `ResidueClass` calls) uses the `Equal`
dispatch above when at least one side is a value of a kind type that has
`compare` (`U.is(2)` is `true` when `Equal(U, 2)` is; symmetric in operand
order), and `isSame` otherwise; an explicit `tolerance` argument is ignored
for a kind value, and the documentation of `.is()` says so.

**The public arithmetic methods.** `.add()`, `.mul()`, `.div()`, `.pow()`,
`.neg()`, `.inv()`, `.sqrt()` reach `residueArithmetic()` today
(`arithmetic-add.ts`, `arithmetic-mul-div.ts`, `arithmetic-power.ts`,
`boxed-function.ts`). `residueArithmetic()` becomes the kind dispatch for
these methods, with the same hooks and the same rules; the methods do not
evaluate their operands (as today), so a hook receives what the caller
built. Route parity: `a.add(b)`, `ce.function('Add', [a, b]).evaluate()`
and `ce.parse(…)` give one value for kind operands (tests, section 7).

**`apply`.** At a threadable apply site (4.3), a collection operand is
mapped first, as the generic broadcast does today, and the dispatch runs
per element on scalars: `Sin([U1, U2])` is a list of two `apply` results,
`Floor([U, 2.5])` is `[Floor(U) by apply, 2]`. At an apply site whose
parameter is a collection type, the dispatch looks for a kind value among
the elements of the collection operand, which it enumerates once into a
snapshot (`ops.elements(i)`) — BOUNDED: no enumeration when the element
type is provably kind-free (the static type says `list<real>`), when the
count is unknown or infinite, or when the count exceeds
`engine.maxCollectionSize` (the limit that `boxed-function.ts` applies to
every materialization; `Range(1, 10^20)` is finite with a bigint count and
is not enumerated); in those cases the operator's own handler runs (`Mean`
keeps its closed form over a `Range`), and cancellation applies as to any
enumeration. When a kind value is found and the kind declares `apply`,
`apply` is called in place of the operator's `evaluate` handler;
`undefined` leaves the expression unevaluated; a kind without `apply` lets
the handler run, with the same snapshot. With two kinds among the
operands, the kinds are asked in order of first occurrence and the first
answer wins. During phase 1, the kind dispatch runs BEFORE the name-based
quantity and measurement branches that remain until phase 2, which then
see only the operands no hook folded; a sum or product that mixes a library
kind and a user kind is outside the phase-1 acceptance table. A USER operator declared
over `real` with a handler is an apply site like a library one: today
`h(5 ± 0.1)` for `h: (real) -> real` runs the handler (the nominal typing
admits the measurement); after phase 2 the measurement `apply` runs instead
and, for an operator it does not know, answers `undefined` (section 6); an
operator that handles measurements itself declares its parameter
`real | measurement`. The nine `measurementUnaryByHead()` call sites, the
`Factorial`, `Abs`, `Floor` family branches and the `statistics.ts`
branches for a measurement become the `apply` of the measurement kind. The
dispatch runs on the evaluated operands, after the operator's own operand
evaluation, and `evaluateAsync` dispatches the same way.

Two kinds in one sum (`Quantity(2, m) + Measurement(3, 0.2)`): each kind's
hook is asked in turn (step 3); the quantity kind folds nothing (a
measurement is not a quantity, and a sum does not absorb one), the
measurement kind folds nothing, and the sum stays as it is, typed
`measurement | quantity` (4.5), which fixes CE-508.6. A quantity whose
magnitude is a measurement is one value of the quantity kind, whose hook
adds the magnitudes through the engine (4.3) and so through the measurement
kind's hook.

### 4.5 Type handlers

The kind typing applies at three sets of operators: the group-1 operators
(4.2), the `apply` sites (4.3, a kind arm in the element type of a
collection operand counts), and the group-2 operators that NAME a kind type
in a parameter (`Abs`, `Sin`, `Convert` for `quantity`). Every other
operator (`GCD (any*)`, `List`, `Hold`, a function with a body) uses its own
type handler on the operand as typed: `GCD(4 ± 0.1, 6)` is typed `integer`
as today. `Sum`, `Product` and `Reduce` over a collection of kind
values are typed as `Add` (`Multiply`) over the element type by the rules
below (`Sum([c1, c2])` is `residue`; today `number`). For the typing, a
kind TYPE "has `apply`" or "has `compare`" when ANY registered head of the
type declares it (the group-1 reading), so a free symbol of the type and
the type-only route have an answer; a value whose own head lacks the hook
declines at evaluation and keeps that static type. At the three sets, the static result type is, in order:

1. the SHAPE is derived as `residueShapedResultType()`
   (`arithmetic.ts:4507`) derives it today: each kind arm of an operand
   type is replaced by a scalar placeholder, the operator's own type handler
   runs on those types (which gives the broadcast shape:
   `ResidueClass(2, 5) · (1, 2)` is a `tuple<residue, residue>`,
   `c · [1, 2]` a `list<residue^2>`, `Quantity(2, m) · [1, 2]` a list);
2. every placeholder cell of the result is replaced by the CELL type, which
   is the union over the kind types among the operands of: that kind type's
   `resultType()` answer when it gives one (per type, so a valueless
   `q1 / q2` with `q1, q2: quantity` is typed `number | quantity`), else the
   kind type itself. Each kind type contributes independently, so a kind
   whose hook can give a number keeps the `number` arm beside another kind
   that has no `resultType` (`A(1) / B(1)` is `number | a | b`);
3. the kind-free arms of a possibly-kind operand keep the operator's
   ordinary result (`Negate(u)` with `u: real | measurement` is
   `real | measurement`; `Divide(u, 2)` with `u: integer | measurement` is
   `rational | measurement`; `Sin(u)` with `u: real | measurement` is
   `real | measurement`), with the `nan` and absence arms the handler
   already adds and the certainty rule of the residue plan §11;
4. except that an operator whose declared result type is not a number type
   keeps it: the relational operators, `Equal`, `IsInteger` are `boolean`;
5. and except that an apply site whose kind type has no `apply` is typed by
   the operator's ordinary result with the carrier substituted for the kind
   arm, because the operator's own handler runs and returns what it returns
   (`h(K(1))` for `h: (real) -> real` and a kind `K` without `apply` is
   `real`); and a group-2 operator that NAMES the kind type in its
   parameter and has its own handler (`h2: (real | umeasurement) -> real`)
   keeps its DECLARED result type, which is the host's promise
   (ARCHITECTURE.md, "Who provides a type"), unless the kind type's
   `resultType` answers for it (`Quantity` answers for `Abs` and the
   trigonometric functions).

The comparison operators `Max`, `Min` and `Clamp` with a kind that declares
`compare` are typed as the union of the kind arms of their operands
(element types for a collection operand) and of the operator's own type
over the kind-free operands: `Max(2 m, 3 m)` is `quantity` (it is `number`
today), `Max(U, 3)` is `integer | umeasurement`; `Sort` is the list of that
union.

`Quantity` answers `number | quantity` for `Multiply`, `Divide` and `Power`,
whose hooks can give a dimensionless number (`6 m / 3 m` is `2`), `quantity`
for `Abs`, and `number` for the trigonometric functions (the handler folds
an angle to a number or declines, so `Sin(2 m)` is typed `number`, section
3); `Measurement` needs no `resultType` because every measurement hook
returns a measurement (section 6: the zero-uncertainty collapse is
removed). The acceptance rows of section 3 check `Less`, `Floor`,
`Negate(u)`, `Divide(u, 2)`, `Abs(-2 m)`, `Sin(2 m)`, `q1 / q2`,
`c · (1, 2)`, `Max(2 m, 3 m)`, `Mean([U, U])` and the dimensionless
quotient, on the unevaluated expression and on an enclosing call.

### 4.6 Recognition and the protection from the number rules

`containsResidueClass()`, `holdsResidueClassForCertain()`,
`isResidueClassOperand()` and `typeIsResidueForCertain()` generalize to
`holdsKindValue(expr)`, `holdsKindValueForCertain(expr)`,
`isKindOperand(d, engine)` and `typeIsKindForCertain(t)`, with one change of
input: the set of kind types and kind heads of the engine, instead of the
constant `residue` and `ResidueClass`. The structural walk, the transitive
read of a symbol's value, and the two readings of a type (non-strict: an
arm `real | measurement` counts; strict, "for certain": it does not) are
unchanged. Recognition descends into collection element types as the
residue implementation does (`L - L` with `L: list<measurement>` is
recognized). The 13 files that call the residue predicates call the
generalized ones; the number of call sites does not change. The non-strict
reading serves canonicalization, evaluation and `simplify()` (as
`containsResidueClass()` does in `simplify.ts` today); the strict reading
serves the compile boundary only (the residue plan §11).
Beyond the four predicates, every site that reads the `residue` PRIMITIVE
by name reads "a registered kind type" instead: `hasResidueArm()`,
`withoutResidueArm()`, `withoutResidueArmDeep()` (`common/type/utils.ts`,
used by `boxed-operator-definition.ts`, `collections.ts`,
`derive-application-type.ts`), `residueAsInteger()` (`arithmetic.ts`), the
contextual element stamp `ADMISSIBLE_ELEMENT_PRIMITIVES` (`box.ts:2646`),
the juxtaposition rule of `invisible-operator.ts:650` (two kind values
juxtaposed parse to a product, as two classes do; today two `GF8` values
parse to a `Tuple`), and `cellTypeMayCarryDimensions()`
(`common/type/primitive.ts`: a literal list of kind values is a
`list<gf8^2>`, as `[c1, c2]` is a `list<residue^2>`; today `list<gf8>`).
The canonical folds of a group-3 operator that do not read a numeric
property (`Log(1, base)` → `0`, `canonical-numeric.ts:406`) are guarded
like the number rules: they do not fire when an operand holds a kind value
by the non-strict reading, so `Log(1, K(2))` reaches `apply`.

**The kind registry and its lifetime.** The registry has two parts.

- The TYPE part (the set of kind types, their per-type fields) is
  engine-level, beside the type registry (4.1.1), not in a scope: a head
  declared with a kind in a nested scope registers its type for the engine,
  and a `popScope()` does not unregister it (the head is gone, the
  protection of its type stays, which is the safe direction). It drives
  recognition and admission.
- The DISPATCH part (head → hooks) is keyed by the bound operator
  DEFINITION, not by the head's spelling, so that an expression keeps the
  hooks of the definition it was bound to (`docs/SCOPING-MODEL.md`,
  "Callable resolution"): an inner scope that declares another `MyMod` with
  other hooks does not change the outer expressions, and the inner values
  keep the inner hooks after the pop. A redeclaration of the SAME binding
  (`{ extend: true }`) replaces its entry; a redeclaration WITHOUT
  `arithmetic` removes the entry (the type's protection and per-type fields
  stay).

The registry has a generation counter, incremented by every registration,
replacement, removal and restore. The per-expression recognition cache
(the module-level `CLASS_FACTS` and `CLASS_SYMBOLS` maps of
`residue-class.ts`, generalized) stores the generation it was computed
under and is recomputed when the generation moved; so an
expression boxed before `ce.declare('MyMod', { arithmetic })` is recognized
after it. Admission is not revisited: `r + 1` with `r: gf8` boxed before
`GF8` declares `add` is an `incompatible-type` error and stays one; the same
expression boxed after the registration evaluates through `add`. Both parts
of the registry are covered by the checkpoint model
(`docs/CHECKPOINT-MODEL.md`, "State coverage"): a snapshot captures them
with the definitions, a restore puts them back together with the
definitions they belong to and advances the generation, and the journal
replays a registration, a replacement and a removal. The static pre-pass of
the Epsil checker rolls back its registrations with its transaction, as it
does for types. Tests: a kind declared after boxing; declared in a scope
and popped; two scoped declarations of one spelling with different hooks;
redeclared without the field; register, replace, remove and restore through
a checkpoint.

**The per-engine shortcut** stays per kind type, and keeps the THREE gates
the residue code has (`residue-class.ts:180-243`), each with its own join
events: `enginesWithClasses` (a value was constructed; gates every walk)
becomes `engineKinds: WeakMap<engine, Set<kindType>>`;
`enginesWithClassValues` (a kind value was assigned to a symbol; gates the
walk of symbol values) and `enginesWithResidueDeclarations` (a symbol was
declared with a kind type; gates the read of declared symbol types) become
their per-kind-type equivalents. The caches that store the generation are
the module-level `CLASS_FACTS` and `CLASS_SYMBOLS` maps
(`residue-class.ts:268, 287`), generalized, not a field on
`BoxedFunction`. The events that make
an engine join for a kind type are exactly: a value of a head of that type
is constructed (the `BoxedFunction` constructor, `noteResidueClass()`
today); a value of the type is assigned to a symbol; a SYMBOL is declared
with a type that has an arm of the kind type; a USER callable is declared,
or a function-typed symbol updated, with a result type that has an arm of
the kind type (`noteResidueDeclaration()` through
`signatureReturnsResidue()`, `residue-class.ts:210`, so that
`Apply(If(p, f, g), 2)` with `f, g: (integer) -> residue` is protected in
an engine that has made no class; the library's own signatures are exempt,
as today); a kind is registered AFTER
the library bootstrap (a user kind: the engine joins for its type at
registration, so a nominal head boxed before its `arithmetic` was declared
is recognized without another event). The result type of a library kind
head and the parameter types of the operators that name a kind type do NOT
join the engine: `Quantity`, `Measurement` and the operators that name
`quantity` are declared in every engine, and an engine that never makes a
quantity pays nothing for the quantity kind, as it pays nothing for classes
today.

**The barrier in `simplify()`.** The residue step
(`boxed-expression/simplify.ts`, about line 1280) becomes the kind step. It
applies to a node whose operator is a GROUP-1 operator or an APPLY SITE of
the kind, when a kind value is held at any depth below it by the
NON-STRICT reading (a body with `x: real | umeasurement` is protected): at
such a node `simplify()` applies no rewrite rule; only the evaluation
through the hooks and the folding of the kind-free terms of a sum or a
product run there (as the step does today for `sin²x + cos²x + c`). The
kind-free operands of any node are simplified first, as today
(`simplify(Tuple(c, sin²y + cos²y))` is `(c, 1)`, measured 2026-10-26). A
group-2 node (`Equal`, `If`, `Tuple`, `List`, `Element`) evaluates and
simplifies as today: `simplify(Equal(c, c))` is `True` and
`simplify(If(Equal(c, c), 1, 2))` is `1`. Today the residue step is limited
to `RESIDUE_ARITHMETIC`; the extension to apply sites is needed because a
residue class is never admitted at `Sin`, so the residue barrier only had
to cover arithmetic, while a measurement or an interval value is admitted
at every real function, and the identities `sin²x + cos²x = 1`,
`ln(e^x) = x`, `|x|² = x²` are wrong for an enclosure (the dependency
problem) and for independent-error propagation (`Sin(U)^2 + Cos(U)^2`:
`Add` and `Power` are group 1, `Sin` an apply site). The step accepts an
evaluated result whose type is a kind type (line 272 today accepts only a
`ResidueClass` call). The generic rules `x - x = 0`, `x/x = 1`, the
absorbing zero and infinity, `Expand`, `Factor` and `Together` keep their
residue guard, now for every kind. This is what fixes CE-508.1 and
CE-508.4.

### 4.7 The three library kinds

- **`ResidueClass`** declares `arithmetic` with `admittedAs: 'none'`, no
  `compare` (classes have no order: `Less(c1, c2)` stays unevaluated typed
  `boolean`, `Max(c, x)` is an error, both as today, the residue plan §4.7),
  and the `residue*` functions of `residue-class.ts` as its hooks. Its
  result type `residue` is unchanged. `Equal(c, c)` and the other operators
  whose parameters admit `residue` directly run their handlers as today. No
  visible change.
- **`Measurement`** declares the kind primitive `measurement`,
  `admittedAs: 'number'` (decision D), `add`/`multiply`/`negate`/`divide`/
  `power` from `measurement-arithmetic.ts`, `compare` by nominal
  (`measurementNominal()`, with the engine tolerance for floats), and
  `apply` from `measurementUnaryByHead()`, `measurementArctan2()`,
  `measurementLipschitzUnary()`, the `Floor` family branches, and the
  `statistics.ts` branches (`Mean`, `Median`, the variance family, over a
  list whose elements include a measurement). `apply` answers
  `incompatible-type` for a complex nominal at a real-only operator. Every
  hook returns a measurement: the zero-uncertainty collapse of
  `makeMeasurement()` is removed (`Cos(0 ± 0.1)` is `1 ± 0`, section 6), so
  no `resultType` is needed. Visible changes: section 6.
- **`Quantity`** declares the kind primitive `quantity`,
  `admittedAs: 'none'`, `add`/`multiply`/`negate`/`divide`/`power` from
  `quantity-arithmetic.ts` (`multiply` absorbs a measurement operand as the
  magnitude, as `quantityMultiply()` does today), `compare` from
  `compareQuantities()` (after conversion, with the engine tolerance for
  floats as numbers have; the zero tolerance of today's extrema is
  dropped), and `resultType` answering `number | quantity` for `Multiply`,
  `Divide` and `Power`, `quantity` for `Abs`, and `number` for the
  trigonometric functions. `quantityAdd()` changes to
  return one fold per dimension and leave the other operands alone
  (CE-508.3). The arithmetic operators admit it by rule (4.2, group 1):
  `Sqrt(4 m^2)` keeps working; `Max(2 m, 3 m)` through `compare`. The
  operators that special-case a quantity beyond that today (`Abs`, the
  trigonometric functions, `Convert`, and the others the inventory of
  section 8 lists) name `quantity` in their parameter type and get their
  result type from 4.5 (`Abs(-2 m)` is `2 m`, typed `quantity`; today it is
  typed `value` and stays unevaluated, section 6). A trigonometric function
  admits every quantity at boxing (the type carries no dimension; measured
  2026-10-26, `Sin(2 m)` is valid today and stays unevaluated): `Sin(2 deg)`
  keeps its canonical fold to `Sin(π/90)`, and `Sin(2 m)` is admitted and
  stays unevaluated, as today, because the handler finds no angle
  (`angularQuantityToRadians()` answers `null`). A user function declared
  over `real` refuses a quantity, as it does today (a quantity is typed
  `value` and is not a `real`).

### 4.8 Compilation

The compile boundary applies the strict recognition of 4.6: an expression
that holds a kind value for certain, or whose result type is a kind type
for certain, declines unless the kind type has a lowering for the target.
An expression that only MAY hold a kind (`number | residue`, a parameter
typed from a signature that admits a kind) compiles as a number, as today.
The explicit residue test in `base-compiler.ts` becomes this general test;
the message names the kind's type.

The compile contract is split in two, because a free symbol `r: residue` has
no head: what the host passes at run time, what `freeSymbolTypes[].lowered`
reports, and how `Add`, `Multiply`, `Sin` lower must be the same for every
head of the type, while a literal `ResidueClass(2, 5)` or `MyMod(2, 5)` is a
call of one head.

```ts
interface ArithmeticCompile {
  /** PER TYPE: the representation and the operations. Given by any head of
   * the type; stored under the type; a second head of the same type that
   * gives a different one is refused (4.1.2); a head that gives none
   * inherits the type's. */
  type?: {
    /** The target representation of a free symbol of the kind's type, as
     * `freeSymbolTypes[].lowered` reports it, or `undefined` when the
     * target has none (the compile boundary then declines). */
    lowered(context: OperatorCompileContext): string | undefined;
    /** A sum or a product with an operand of the kind. A number operand
     * beside a kind value is the hook's to promote. */
    add?(args: ReadonlyArray<Expression>, compile: (e: Expression) => string, context: OperatorCompileContext): string | undefined;
    multiply?(args: …): string | undefined;
    /** The other arithmetic operators, the comparisons, and the group-3
     * operators with an operand of the kind. NOT the structural and
     * control-flow operators (`If`, `Block`, `List`, `Tuple`, `Assign`,
     * `Hold`, a call of a user function): they compile as today and treat
     * the representation as an opaque value. With two compilable kinds
     * among the operands, the kinds are asked in order of first
     * occurrence and the first answer wins, as at evaluation (4.4). */
    apply?(operator: string, args: …, compile: …, context: …): string | undefined;
    /** The run-time entry check of a host value passed for a free symbol
     * of the kind's type (`checkEntry()`, `javascript-runtime.ts:7491`,
     * calls it instead of its numeric and collection rules). */
    entry(value: unknown, context: OperatorCompileContext): boolean;
    /** Whether code from this lowering may be shipped to the kernel pool
     * as text; default `false` (the result is not shippable). When `true`,
     * `hostNames` lists the helpers the shipped code needs. */
    shippable?: boolean;
    hostNames?: ReadonlyArray<string>;
  };
  /** PER HEAD: the source of a literal value of this head, in the type's
   * representation. A head without it declines a literal of that head. */
  value?(value: Expression, compile: (e: Expression) => string, context: OperatorCompileContext): string | undefined;
}
```

The hooks branch on `context.language`, like the existing `compile` handler
of an operator definition, so a target registered with
`ce.registerCompilationTarget()` is reachable. `undefined` from any hook
declines with the existing capability diagnostic. A compiled function
whose result is a kind value returns the representation RAW, exempt from
`normalizeRunResult()` (`javascript-runtime.ts:7618`, which turns a
`{ re, im: 0 }` record into a number); so a representation may not be a
JavaScript number, a `{ re, im }` record or an array of numbers, which the
runner would read as a number, a complex or a list
(`docs/COMPILATION-MODEL.md` requires a faithful representation).
`freeSymbolTypes[].type` reports the kind type and `.lowered` the value of
`lowered()`. Two limits of phase 1, each with the kind message: an
expression that holds a COLLECTION of kind values (`L + L` with
`L: list<gf8>`) declines on every target, because `entry` and `lowered` are
defined for a scalar only; and a compiled result whose code came from a
kind lowering cannot be STORED (`docs/COMPILATION-MODEL.md`, "Running
stored JavaScript"), because `entry` is a callback that a stored artifact
cannot carry, so `store()` declines it and a loaded artifact never runs
without the check. Acceptance example for a user kind `G` over `gf8` with a full
`javascript` contract whose representation is `{ gf8: n }`:
`compile(ce.parse('g + G(2)'), { to: 'javascript' }).run({ g: { gf8: 1 } })`
returns `{ gf8: 3 }`, `freeSymbolTypes.g` is `{ type: 'gf8', lowered:
'gf8' }`, `run({ g: 1 })` throws at entry, and the result reports
`shippable: false`. A kind is never compiled
through the number rules: `c - c` lowered to `0` would be a wrong value with
no error. Two heads of one type cannot disagree on the algebra of a free
symbol, because the type has one `type` contract.

The `interval-js` target already has the representation (`{ lo, hi }`) and
the lifted functions (`_IA.add`, `_IA.sin`, `_IA.abs`, …) that an interval
value kind needs for its `type` contract. Its value model is one interval
per quantity (`interval-javascript-target.ts:7`): a function across a pole
answers `singular` or the entire line, not a disconnected union. The
compiled result is therefore an enclosure of the symbolic value (it contains
every point of the union) and not its shape; phase 3 states this as the
contract of the lowering, and a host that needs the shape evaluates.
`Measurement` and `Quantity` declare no `compile` in this plan; they decline
as today.

### 4.9 Interval values (#416)

A new head for an interval VALUE, with a kind primitive,
`admittedAs: 'real'`, and `compare` for the partial order of enclosures
(`undefined` when the two overlap). The set `Interval` stays a set: `Abs` of
a set is its cardinality and does not change. The reporter of #416 follows
Mathematica's `Interval` (outward-rounded endpoints, exact where the
endpoints are exact, a function's image from its endpoints and interior
critical points, a `Union` across a pole) and offered to port their
implementation. Phase 3 defines the value model (the empty value, a
disconnected union, the complex-capable ball `CenteredInterval` as a second
kind or not), the head's name and LaTeX, and the lowering contract of 4.8.
The kind is the third phase and is not needed for #477.

### 4.10 A library user can do what the library does

The user's rule (2026-10-26): an extension point that only the engine or the
library can use is not acceptable when an alternative open to a library user
exists. This plan meets it as follows:

- The field, the hooks, the admission (including group 1 of 4.2, which
  reads the registry and not a literal in a library signature), the
  comparison dispatch (operators and methods), the recognition, the
  registry and the compile contract are the same code for a library kind
  and a user kind. No code path tests "is this a kind primitive".
- A user kind declares a nominal type over `value` with `mint: false`
  (public from phase 1) and a head with `arithmetic`; everything
  `Measurement` or `ResidueClass` can do, it can do. The one difference is
  where the type is spelled: a kind primitive is a word of the type
  language, a nominal type is a record of the engine. A user who wants a
  library kind primitive opens an issue.
- The test suite proves it with two user kinds in phase 1: `GF8`, a
  `'none'` kind over a nominal type `gf8` (a finite field with its own
  `add`, `multiply`, `negate`, `divide`, `power`, no `compare`), which
  checks group 1 and group 2 of 4.2 without any library signature naming
  `gf8`; and `UserMeasurement`, a `'number'` kind over a nominal type
  `umeasurement` with the measurement hooks copied from the library,
  `compare` and `apply`, which runs the measurement acceptance rows of
  section 3 (before `Measurement` itself moves in phase 2). Phase 2 then
  runs the same rows through `Measurement`.

## 5. Phases

0. **Documentation, DONE 2026-10-26.** `doc/06-guide-augmenting.md`: the
   advice to extend `Add` with `{ extend: true }` is removed; the section
   says that a sum of the values of a head declared `-> residue` stays
   unevaluated until the hook ships, and links CE-507. `CHANGELOG.md`: the
   sentence "defines its own" arithmetic for such a head is corrected.
1. **The mechanism and `ResidueClass`.** Starts when a review round
   reports no high finding against it. `arithmetic` on the definition, the
   declaration checks, the public `mint: false` and the `value`-definition
   subtyping rule, the admission groups of 4.2 (the registry-read of group
   1 replaces the literal `residue` in the arithmetic signatures), the
   dispatch in the arithmetic handlers, the comparison dispatch (operators
   and methods), the public methods and `apply` (with collection operands),
   `resultType`, the generalized recognition, registry and `simplify()`
   barrier, the generalized compile decline and the compile contract WIRED
   into `base-compiler.ts` (`compile.type.lowered/add/multiply/apply` and
   `compile.value` are called; a user kind with a full contract compiles on
   `javascript`, one with only `value` declines; no library kind declares a
   lowering yet), `ResidueClass` moved onto the field, the `GF8` and
   `UserMeasurement` test kinds of 4.10, and the documentation
   (`doc/06-guide-augmenting.md` rewritten around the field;
   `doc/08-guide-types.md`, `docs/TYPE-SYSTEM.md`, `CHANGELOG.md`). Answers
   #477. No visible change for residue classes.
2. **`Measurement` and `Quantity` on the field.** Prerequisite: the
   inventory of section 8, reviewed as the acceptance table of this phase.
   The kind primitives `measurement` and `quantity`, their admission,
   `compare`, the removal of the name-based branches, the `quantity`
   parameters of the operators of 4.7. Fixes CE-508.1 to CE-508.4 and
   CE-508.6. Visible changes (section 6), measured before landing.
3. **The interval value kind.** After the open questions of 4.9 are decided,
   with the `interval-js` lowering. Prerequisite (2026-10-26): CE-507.8, a
   decoded-payload cache on a boxed call (a `WeakMap` from the boxed value to
   its decoded payload, filled on the first decode, never invalidated
   because boxed expressions are immutable, derived state under the
   checkpoint model), so that the quantity hooks stop parsing the unit
   expression on every call and the interval hooks decode `{lo, hi}` once.
   CE-507.7 (a non-commutative product; PR #482 asks for it) is pinned by the
   user until after phase 3.

## 6. Public changes

- Phase 1, deliberate change for residue classes (the user, 2026-10-26:
  accidental behavior may change): the kind-free terms of a sum or product
  with a class are combined by `evaluate()` as `simplify()` already
  combines them: `x + x + ResidueClass(1, 5)` evaluates to
  `2x + ResidueClass(1, 5)` (it was returned as written) and
  `(√2 + π + c).N()` adds the two floats (they were left apart). The residue
  rules themselves do not change.
- Phase 1, defect fix: a declared `L: list<residue>` is admitted at the
  arithmetic operators and broadcast (`L + L`, `Negate(L)`, `L · 2` were
  `incompatible-type` errors at boxing).
- Phase 1: `OperatorDefinition.arithmetic` (new), `ArithmeticDefinition`,
  `KindOperands`, `KindOperand`, `KindFold`, `ArithmeticContext`,
  `ArithmeticCompile` (new types); `ce.declareType(name, body, { mint: false })`
  (public option); a nominal type defined as exactly `value` is a subtype
  of `value` and `expression`. The signatures of the nine arithmetic
  operators no longer spell `residue` (`Add` is `(number*) -> number` again,
  with the kinds admitted by rule); a host that reads those signature
  strings sees the change. A pre-boxed untyped lambda passed to a binder
  over classes (`ce.function('Map', [ce.box(x ↦ x/x), [ResidueClass(2, 4), …]])`)
  gives classes, as the box and parse routes do (it gave `[1, 1]`, a wrong
  value). Two kind values juxtaposed parse to a product, as two classes do.
- Phase 2, types: `Measurement(…)` is typed `measurement` (was its
  nominal's type, `integer`, `real` or `complex`); `Quantity(…)` is typed
  `quantity` (was `value`). A host that compares type strings sees the
  change. The type names `measurement` and `quantity` become words of the
  type language: a host that declared a type of either name breaks at
  upgrade (to check in Tycho before phase 2:
  `grep -rn "declareType('measurement'\|declareType('quantity'"` and the
  Epsil sources).
- Phase 2, admission of a measurement: refused at every parameter that does
  not admit `real` (an `integer` parameter, a ranged parameter), at a symbol
  declared `real`, `number` or `integer`, at a valueless symbol that a prior
  use inferred `real` (CLAUDE.md, "Symbol inference is asymmetric": `Sin(x)`
  then `x := Measurement(…)` throws), and at a user function or lambda whose
  parameter is a number type (decision B; `f: (real) -> real` applied to a
  measurement is an `incompatible-type` error; it is admitted today and
  computes with a body that may have folded `x/x` to `1`). The list of
  library operators that refuse a measurement after phase 2 comes from the
  inventory (section 8); `Factorial`, `Mod`, `Binomial`, `Sin`, `Abs` are
  NOT in it (their parameters admit `real`). A complex measurement at a
  real-only operator (`Floor`) is refused at evaluation, not at boxing
  (decision D).
- Phase 2, a user operator declared over `real` with a handler
  (`h: (real) -> real`, `evaluate: ops => ops[0].mul(2)`): `h(5 ± 0.1)` runs
  the handler today (`2 · (5 ± 0.1)`); after phase 2 the measurement `apply`
  runs in its place and leaves `h(5 ± 0.1)` unevaluated, because it does
  not know `h`. An operator that handles measurements itself declares its
  parameter `real | measurement` (group 2), and its handler runs as before.
- Phase 2, operators that handle a measurement today WITHOUT naming it,
  because the nominal typing admits it as a number: `Mod(5 ± 0.1, 3)` is
  `2`, `Sign(5 ± 0.1)` is `1`, `Round(2.5 ± 0.1)` is `3`,
  `Clamp(5 ± 0.1, 0, 3)` is `3`, `Sqrt(0 ± 0.1)` is `0` and
  `Arcsin(1 ± 0.1)` is bare `π/2` (`measurementUnary()` returns the bare
  nominal when the derivative is not available). After phase 2 each one is
  an `apply` site or a `compare` site, and the inventory of section 8
  states its result and static type before phase 2 begins.
- Phase 2, deliberate behavior changes (the user, 2026-10-26: accidental
  or poorly justified behavior may change): `Max`/`Min` of measurements
  decide by nominal like `Less` and `Equal` do (`Max(1 ± 0.1, 1 ± 0.5)` is
  `1 ± 0.1`; it stayed unevaluated because `exactOrder()` refused to
  discard an uncertainty while `Equal` of the same pair was `True`); a
  measurement hook always returns a measurement (`Cos(0 ± 0.1)` is `1 ± 0`
  and `1 ^ (2 ± 0.1)` is `1 ± 0`; they were the number `1`); quantity
  extrema use the engine tolerance like the other quantity comparisons;
  `Abs(Quantity(-2, m))` is `Quantity(2, m)` (it stayed unevaluated).
- Phase 2, values: `Quantity(2, m) - Quantity(2, m)` simplifies to
  `Quantity(0, m)` (was `0`); `Measurement(2, 0.1) - Measurement(2, 0.1)`
  simplifies to `Measurement(0, 0.141…)` (was `0`); `x + 2 m + 3 m`
  evaluates to `x + 5 m` (was unchanged); `2 m + 30 cm` simplifies to
  `2.3 m` (was unchanged); `Sin(M)^2 + Cos(M)^2` for a measurement `M` no
  longer simplifies to `1`; `ce.box(['Add', c, q]).type` for a class and a
  quantity is `quantity | residue` (was a wrong list type);
  `Sin(Quantity(2, m))` is typed `number` (was `value`).
- Phase 2, as implemented (2026-10-26; the CHANGELOG has the same list for
  hosts). Where this list and the items above differ, this list and section
  13 hold:
  - The zero-uncertainty collapse stays (decision 3, A1): `Cos(0 ± 0.1)` and
    `1 ^ (2 ± 0.1)` are `1`, as before. The item above that says `1 ± 0` is
    withdrawn. The result of an operator with a measurement operand is typed
    `number | measurement`, except at `Add`, `Negate`, `PreIncrement`,
    `PreDecrement`, `Conjugate`, `Real`, `Re` and `Abs`, which keep the
    uncertainty and are typed `measurement`. `Floor(2.5 ± 0.1)` was typed
    `integer`.
  - `.re` and `.im` of a measurement keep the nominal (13.2), through the new
    optional field `ArithmeticDefinition.numericValue()`. The fact queries
    (`isPositive`, `sgn`, `isInteger`) of a measurement are `undefined`; they
    were the facts of the nominal (`Measurement(4, 0.1).isInteger` was
    `true`).
  - New public fields: the answer `'unordered'` of `compare` (A6),
    `ArithmeticDefinition.isExact()` (decision 13),
    `ArithmeticDefinition.numericValue()`, and `ArithmeticContext.tolerance`
    (the tolerance of `.is()`, given to `compare`; `undefined` for the other
    comparisons). `M.is(2.6, 0.2)` for `M = 2.5 ± 0.1` uses the tolerance
    `0.2`; the tolerance of `.is()` was not given to a kind in phase 1.
  - Signatures: the 24 trigonometric functions are `(complex | quantity) ->
    number` (or with `signed_infinity`), `Abs` is
    `(complex | infinity | quantity) -> number`, `Measurement` is
    `(value, value) -> measurement` and `Quantity` is
    `(value, value) -> quantity`. The `incompatible-type` messages of these
    functions name the `quantity` arm (`Sin("a")` expects
    `complex | quantity`), and so does the type of `Derivative(Sin)`.
    `Arctan(2 deg)` folds to `Arctan(π/90)` (decision 15; it stayed as
    written).
  - A quantity is refused at boxing by every operator that does not accept
    it: `Round`, `Floor`, `Sign`, `Exp`, `Hypot`, `InverseHaversine` (they
    stayed unevaluated or gave a wrong value), and `Mean([2 m, 4 m])` (it
    stayed unevaluated, typed `number`; ROADMAP CE-507.10).
  - Measurement values that change: `Floor(2.95 ± 0.1)` was `2` and is
    unevaluated (decision 1); `Mod(5 ± 0.1, 3)` was `2` and is `2 ± 0.1`
    (decision 2); `Sqrt(0 ± 0.1)` was `0` and `Arcsin(1 ± 0.1)` was `π/2`,
    both unevaluated (decision 4); `Arccos(2.5 ± 0.1)` was the bare
    `1.5668i` and is `1.5668i ± 0.0436` (decision 5);
    `Binomial(5 ± 0.1, 2)` was `(5 ± 0.1)·((5 ± 0.1) − 1)/2` and
    `Determinant([[1 ± 0.1, 2], [3, 4]])` was `-2 ± 0.4`, both unevaluated
    (decision 7); `Degrees((2 + 3i) ± 0.1)` was a complex value with an
    uncertainty and is an `incompatible-type` error, while `Degrees(2 + 3i)`
    still folds (ROADMAP CE-507.9); `Max(2 ± 0.1, 2)` was `2` and is
    `2 ± 0.1` (decision 12); `Clamp(3 ± 0.1, 0, 3)` was `3` and is `3 ± 0.1`
    (decision 10); `ElementMax(2.5 ± 0.1, 3)` is typed
    `integer | measurement` (was `real<3..>`); `Max(3/2 ± 1/10,
    Indeterminate)` is `NaN` (decision 13). A measurement assigned to a symbol
    declared `real` was accepted and now throws; `f: (real) -> real` with a body gave `4 ± 0.4`
    for `f(2 ± 0.1)` and is an error; `h(5 ± 0.1)` with a handler gave
    `2 · (5 ± 0.1)` and stays unevaluated.
  - Quantity values: `Max(1 m, 1.000000000001 m)` is `1 m` (the engine
    tolerance, with a tie keeping the first operand); the finer-unit
    tolerance policy stays (A7). A quantity with a float magnitude is not
    exact: `Max(1.5 m, Indeterminate)` is `NaN`.
  - The public methods fold kind values (A15): `M.add(M2)` is `5 ± 0.141`
    (it was the sum of the two measurements), `(2 m).add(30 cm)` is `2.3 m`
    (it was `30 cm + 2 m`), `.sqrt()` of a measurement propagates. `.neg()`
    does not call the `negate` hook: `c.neg()` is `Negate(c)`, so that the
    `add` hook sees `Negate(b)` in `a - b` (the temperatures with an offset,
    A16).
  - Compilation: an expression with a measurement or a quantity fails with
    the kind message ("holds a value of the kind type 'measurement'"); it
    failed with "Could not compile `Measurement`". A product with a physical
    constant symbol (`x · SpeedOfLight`) still fails with the old message:
    the symbol is declared `value`.
  - Cost: the value of a physical constant is a quantity, made while the
    libraries load. The gates of `quantity` stay closed during the load
    (`deferKindValueGates()`), and the constant makes its value again at its
    first read, so an engine that never reads a constant and never makes a
    quantity does not pay for the quantity recognition (about 10% of an
    ordinary evaluation).

## 7. Tests

- Phase 0: none (documentation).
- Phase 1, residue: the `MyMod` rows of section 3 through `evaluate()`,
  `simplify()` and `.N()`, on the `ce.box`, `ce.parse`, `ce.function` and
  method (`a.add(b)`) routes; `negate` required; the declaration check
  refuses `-> integer`, `-> value`, `-> any`, `-> expression`, `-> boolean`,
  `-> residue | integer`, a nominal type defined as `integer`, and accepts
  `-> residue`, `-> residue | nan`; the residue test files unchanged and
  green (`item-399-residue-class.test.ts` and the tests of the 2026-10-23
  plan, which include `Equal(c, c)`, `Less(c1, c2)` unevaluated,
  `Max(c, x)` refused, `Sin(c)` refused); `Sum(k/k)` over classes; the
  compile decline for `MyMod` with and without a `compile` contract, and
  two heads of `residue` with a conflicting `type` contract refused; the
  per-kind engine shortcut in a fresh engine (declaring `Quantity`-like
  heads does not join; registering a user kind does); a kind declared
  after boxing, in a scope then popped, and redeclared without the field.
- Phase 1, `GF8` (`'none'`, nominal): `ce.type('gf8')` is a subtype of
  `value` and `expression` and provably disjoint from `number`, `boolean`,
  `string` and `list`, and `Fact.CouldBeNumber` is false for a `gf8`
  symbol; `GF8(1) + GF8(2)` on every route without a library signature
  naming `gf8`; assignment to a `value` symbol, `List`, `Hold`,
  `Equal(k, k)`, `Equal(GF8(1), "abc")` is `False`; `Less(GF8(1), GF8(2))`
  unevaluated typed `boolean`; `Max(GF8(1), GF8(2))` typed `error`;
  `Sin(GF8(1))` refused at boxing; `GF8(1) · (1, 2)` typed
  `tuple<gf8, gf8>`; `GF8(1) / GF8(0)` left as it is by a `divide` that
  returns `undefined`; `r + 1` with `r: gf8` boxed before `GF8` is declared
  is an `incompatible-type` error and stays one, the same boxed after
  evaluates; a nominal type defined as `integer` refused as a kind type;
  two scoped `GF8` declarations with different hooks; register, replace,
  remove and restore through a checkpoint; `k: (value) -> value` with the
  body `x/x` gives `1` for `GF8(3)` (the documented fold).
- Phase 1, `UserMeasurement` (`'number'`, nominal, with `compare` and
  `apply`): admitted at `Sin`, `Factorial`, `Abs`, `Floor`; refused at an
  `integer` parameter (one found from the signatures) and at a symbol
  declared `real`; `string | umeasurement` refused at `real`; `Less`,
  `Equal(U, 2)`, `Equal(U1, U5)`, `Max(U1, U5)` through `compare`, typed
  `boolean`/`umeasurement`; `a.isLess(b)`, `Sort`, `Clamp` through the same
  `compare`; `Floor` typed `umeasurement`; a complex nominal at `Floor`
  refused at evaluation; `Negate(u)` with `u: real | umeasurement` typed
  `real | umeasurement`, `Divide(u, 2)` with `u: integer | umeasurement`
  typed `rational | umeasurement`, `Sin(u)` typed `real | umeasurement`;
  `Mean([U, U])` through `apply` with a collection operand, typed
  `umeasurement`, also over a lazy collection whose callbacks are counted
  (one enumeration), `Mean(Range(1, 10^20))` keeping its closed form, and a
  lazy `Map` of `U` values over a count above `maxCollectionSize` left to
  the handler; `Sin([U1, U2])` mapped per element; `Floor([U, 2.5])`;
  `Map(x ↦ x + GF8(1), [GF8(2)])` typed `list<gf8>` and
  `Map(x ↦ Sin(x), [U1, U2])` typed `list<umeasurement^2>` by the type-only
  route, equal to the boxing route; `(GF8(1) + GF8(2)).is(GF8(3))`; the
  compile example of 4.8 (`run`, the entry check, `freeSymbolTypes`,
  `shippable: false`) and a kind with only `value` declining; two heads of
  `gf8` live at once with conflicting `compile.type` refused, the same
  `GF8` declaration run twice accepted (new closures replace the fields),
  and a user head adding `compile.type` to `residue` refused; a lazy user
  operator `Choose`-like with an impure unselected operand and a `U` in the
  selected one, on the box, parse, sync and async routes; an operator with
  the arms `(real) -> real` and `(real | umeasurement) -> real` choosing the
  second for `U`; `h: (real) -> real` with a handler and a kind `K` without
  `apply`: the handler runs and the call is typed `real`; `Abs(U)` with a
  positive nominal not folded by a canonical property read;
  `Clamp(GF8(1), 0, 3)` typed `error` and `Sort([GF8(1), GF8(2)])`
  unevaluated, `Sort(…, order)` with an explicit callback evaluated;
  `Map(x ↦ x/x, [GF8(1), GF8(2)])` keeping `x/x` on the three routes;
  `[GF8(1), GF8(2)]` typed `list<gf8^2>`; `GF8(1)GF8(2)` juxtaposed
  parsing to a product; `Sum([GF8(1), GF8(2)])` and `Reduce(L, Add)` typed
  `gf8`; two heads of `gf8` of which only one declares `compare`, `Max` of
  a free `gf8` symbol typed by the type-level reading; a redeclaration of
  `G` with another `compile.type` refused while `H` is live; a lazy
  `Choose(True, U, Random())` giving `U` with no draw; `Log(1, K(2))`
  reaching `apply`; `U.is(2)` and `U.is(2, 0.5)`; a quantity-like user
  kind with `eq` beside `compare` deciding `Equal` of two dimensions;
  `L + L` with `L: list<gf8>` declining to compile, and `store()` of a kind
  result declining;
  `A(1) / B(1)` for two user kinds of which only `A` declares `resultType`,
  typed `number | a | b`; a `DeclareType` that replaces `gf8 = value` by
  `gf8 = integer` refused; `Max(U1, U5)` typed `umeasurement`, `Max(U, 3)`
  typed `integer | umeasurement`; `Less(U1, U2, U3)` as a chain; `Sort([U1, x, U2])`
  unevaluated; `Clamp(U, 0, 3)` returning the bound `3`; a user operator
  `h: (real) -> real` with a handler left unevaluated for `U`, and
  `h2: (real | umeasurement) -> …` running its handler; an `apply` that
  returns `undefined`, one that throws, a
  kind with no `apply` (the handler runs), a fold with an invalid index;
  `exact(i)` under `.N()` for a pure and an impure operand; the `written`
  form of a subtraction; two folds in one answer; two kinds in one sum and
  in one product (both orders); `f(x) := x - x` with `x: real` refused at
  the call, with `x: unknown` admitted, and with `x: real | umeasurement`
  giving `0 ± 0.141…` under `evaluate()` and `simplify()`; `x/x` in such a
  body kept; `L - L` with `L: list<umeasurement>`; `Sin(U)^2 + Cos(U)^2`
  not simplified to `1`, also inside a body typed `real | umeasurement`
  simplified before the call.
- Phase 2: the quantity and measurement rows of section 3 with their
  expected values, on the unevaluated expression and on an enclosing call
  for the type rows; the inventory of section 8 as the acceptance table;
  `Sin(2 ± 0.1)` unchanged; the refusals and the deliberate changes of
  section 6; `Sin(2 deg)` and `Sin(2 m)`; `Q · M` in both orders; the
  quantity and measurement test files green with their type-string
  snapshots updated and the count reported.
- Phase 3: the #416 examples (`Sin([0, 1])`, `Abs([-1, 2])`,
  `Tan([0, π])` as a union), `compare` on disjoint and overlapping
  intervals, and the `interval-js` lowering against `IntervalArithmetic`
  directly, including the enclosure contract across a pole.

## 8. Measurements and the phase-2 inventory

- **The phase-2 inventory** (prerequisite of phase 2), in two parts.
  (1) A script lists every site in `src/compute-engine/` that names
  `Quantity`, `Measurement`, `isQuantity(`, `isMeasurement(`,
  `measurementNominal(`, `measurementUnaryByHead(` or `quantityCompare(`,
  and for each one a probe records the behavior today (input, `evaluate()`,
  `simplify()`, the static type) and the hook it becomes (`add`,
  `multiply`, …, `compare`, `apply`, a `quantity` parameter, or "stays: not
  kind behavior"). (2) A script lists every library operator with a
  parameter that admits `real` or `number` (the group-3 set, from the
  signatures with alias normalization), and for each one probes a real
  measurement and a complex measurement today and records the planned
  `apply` answer; this part finds the operators that handle a measurement
  without naming it (`Mod`, `Sign`, `Round`, `Clamp`, the
  derivative-undefined and domain-edge cases `Sqrt(0 ± 0.1)`,
  `Arcsin(1 ± 0.1)`, and their static types). The result is reviewed with
  the dual spec review before phase 2 starts and becomes its acceptance
  table. Four review rounds found a new behavior at such a site each time
  (`Mean`, `Q · M`, the zero-uncertainty collapse, the extremum tolerance,
  `Mod`, `Sqrt(0 ± 0.1)`); the inventory finds the rest at once.
- The list of library operators whose parameters refuse a measurement
  after phase 2 (section 6), from the inventory, with alias normalization
  (`finite_real` is `real`).
- The snapshot blast radius of the phase-2 type changes: run the full suite
  after phase 2, count the changed snapshots, and report the number before
  landing (`CLAUDE.md`, snapshot policy).
- The cost of the generalized recognition on the arithmetic benchmark
  (`benchmarks/`, the `parse`/`rule-dispatch` suites under `CE_PERF`) for an
  engine with no kind value, which must not change, and for one with a
  class, which must stay within the 2026-10-23 measurement.

## 9. Open questions

1. The name of the interval value head and its LaTeX; whether
   `CenteredInterval` is a second kind in the same phase (phase 3, 4.9).

Closed on 2026-10-26: the field name (`arithmetic`); `Quantity` admission
(`'none'` with explicit parameters, 4.7); equality and order (`compare`,
one order for every use, 4.3); complex measurements (decision D, 4.2).

## 10. Alternatives considered

- **A hook for residue heads only** (`residueArithmetic`, the shape proposed
  in #477). Answers #477 with less work, leaves the three mechanisms, and a
  fourth for intervals. Rejected on 2026-10-26.
- **Recognition by head only.** Loses the protection of a symbol declared
  with the kind's type and no value, which the 2026-10-23 design added and
  tests. Rejected.
- **Recognition and dispatch by type only.** Needs behavior on types, which
  the type system does not have, and makes two heads of one type collide.
  Rejected. (Admission, `resultType` and the compile contract are the parts
  that live under the type, because a free symbol has no head; they are
  still declared through a head.)
- **A `field` hook with the laws of a field assumed.** None of the kinds is
  a field (section 1). Rejected.
- **Nominal types for the library kinds too.** Possible, and it would make
  the library and a user spell a kind the same way; but a library signature
  is parsed before any engine exists, so the library would have to declare
  the type before the head in the bootstrap. The capabilities are the same
  either way (4.10). Not chosen; can be revisited without changing the
  mechanism.
- **`apply` at every operator.** Freezes `Equal(c, c)`, `[c, d]` and
  `r := c` for a kind without `apply`. Replaced by dispatch at admission
  sites only (4.3, 4.4).
- **`residue` admitted as `integer`.** Would readmit `Sin(c)` and `Floor(c)`
  (unevaluated before the 2026-10-23 design) and let a class reach integer
  code that computes from the representative. Rejected 2026-10-26.
- **A `nominal(x)` hook for comparisons.** Covers a measurement but not a
  quantity (`2 m < 300 cm` has no single number). Replaced by `compare`.
- **A `purpose` flag on `compare`** (`'equal' | 'order' | 'extremum'`) to
  keep today's `Max` of measurements unevaluated while `Equal` decides by
  nominal. Rejected: the asymmetry is accidental; one order by nominal is
  simpler and recorded as a change (section 6).
- **Admission of a kind at a `real`-parameter function body.** Today's
  behavior for a measurement; wrong when the body folded at declaration
  (`x/x`). Replaced by decision B.
- **Two measurement kind types by the nominal (`measurement`,
  `complex_measurement`).** Keeps the boxing-time refusal of a complex
  measurement at `Floor`; doubles the declarations and the type strings.
  Rejected for decision D.
- **A mark set at kind registration that makes a nominal type a `value`
  type.** Its answer would depend on the order of declarations and on the
  registry's lifetime. Replaced by the definition rule of 4.1.1.

## 11. Files

- `src/compute-engine/types-definitions.ts`: the field and its types.
- `src/compute-engine/engine-declarations.ts`: the declaration check, the
  kind registry, the public `mint: false`.
- `src/common/type/subtype.ts`: a nominal type defined as `value` is
  `<: value` and `<: expression` (beside the `object` rule, about line
  3924) and provably disjoint from every other type (beside
  `provablyDisjointRules()`, line 797); `primitive.ts`, `subtype.ts`,
  `utils.ts`: the kind primitives `measurement` and `quantity` (phase 2).
- `src/compute-engine/checkpoint.ts`, `checkpoint-journal.ts`: the registry
  in the snapshot and the journal.
- `src/compute-engine/boxed-expression/residue-class.ts`: the recognition
  predicates generalized (new file name to decide: `value-kinds.ts`, with
  the residue arithmetic staying where it is); `residueArithmetic()` as the
  method dispatch.
- `src/compute-engine/boxed-expression/boxed-function.ts`: the construction
  note per kind.
- `src/compute-engine/boxed-expression/box.ts` (the contextual element
  stamp), `invisible-operator.ts` (juxtaposition), `canonical-numeric.ts`
  (the `Log(1, base)` guard), `src/common/type/utils.ts`
  (`hasResidueArm()`, `withoutResidueArm()`), `primitive.ts`
  (`cellTypeMayCarryDimensions()`): read a registered kind type.
- `src/compute-engine/boxed-expression/simplify.ts`: the kind barrier.
- `src/compute-engine/boxed-expression/validate.ts`,
  `boxed-operator-definition.ts`: admission (groups 1 and 3, the carrier
  rule).
- `src/compute-engine/boxed-expression/compare.ts`: the comparison methods
  and `exactOrder()` through `compare`.
- `src/compute-engine/library/arithmetic.ts`: the dispatch; the residue,
  quantity and measurement branches removed; the nine signatures without
  `residue`; `residueExtremumError()`/`processMinMaxItem()` generalized.
- `src/compute-engine/library/relational-operator.ts`: `compare` dispatch
  in place of `quantityCompare()` and the `measurementNominal()` reads.
- `src/compute-engine/library/statistics.ts`: the measurement branches
  become `apply` (phase 2).
- `src/compute-engine/library/quantity-arithmetic.ts`, `quantity-compare.ts`,
  `measurement-arithmetic.ts`: the hooks (phase 2).
- `src/compute-engine/compilation/base-compiler.ts`: the general decline and
  the compile contract.
- `doc/06-guide-augmenting.md`, `doc/08-guide-types.md`,
  `docs/TYPE-SYSTEM.md`, `CHANGELOG.md`, `ROADMAP.md` (CE-507, CE-508).

## 12. What the reviews changed (2026-10-26)

Finding numbers refer to `docs/scratch/2026-10-26-value-kinds_SPEC_REVIEW.md`.

Round 7 (phase 1 only):

- 1, 8: "live" defined; a same-binding replacement only when no other head
  of the type is live (4.1.2).
- 2: a group-2 operator that names the kind keeps its declared result type
  unless `resultType` overrides (4.5 rule 5).
- 3: the sites that read the `residue` primitive by name, listed and
  generalized (4.6, 11, 6).
- 4: operators as function values; `Sum`/`Product`/`Reduce` typing
  (4.2, 4.5, 3).
- 5: a kind type "has `apply`/`compare`" when any registered head declares
  it (4.5).
- 6: carrier admission for every operator; apply-site status for non-lazy
  handlers only (4.2).
- 7: `compare`'s `undefined` falls through to `eq` for `Equal`; the
  `Equal(2 m, 2 s)` example corrected (4.3, 4.4).
- 9: a pre-boxed lambda passed to a binder is canonicalized again with the
  stamped element type; one row per route (4.2, 3, 6).
- 10: a user callable declaration joins the engine (4.6).
- 11: the structural canonical folds of a group-3 operator are guarded
  (4.6).
- 12, 18: a collection of kind values and a stored artifact decline in
  phase 1 (4.8).
- 13: `Sort` without `compare` stays unevaluated; `order`; `Clamp` (4.4).
- 14: the cache location stated once (4.6, 11).
- 15: the `Sqrt("banana")` sentence removed (6).
- 16: canonical operand order; `multiply` commutes; non-commutative kinds
  out of scope (4.3).
- 17: `.is()` with a number and the tolerance (4.4).

Round 6 (phase 1 only):

- 1: an apply site whose kind declares no `apply` is typed by the
  operator's ordinary result with the carrier (4.3, 4.5 rule 5).
- 2: a lazy operator is never an apply site (4.2, 4.3).
- 3: the `Equal` fallback: both heads' `eq` in operand order; the
  structural `False` only for provably disjoint types; one kind type
  without `compare`/`eq` is `isSame` or unevaluated (4.4, 3).
- 4: the identity shortcut of the comparisons runs first (4.4, 3).
- 5: the `simplify()` barrier limited to group-1 nodes and apply sites;
  group-2 nodes and kind-free operands as today (4.6, 3).
- 6, 14: the operators `type.apply` covers; `entry`; the raw result exempt
  from `normalizeRunResult()`; the representation restriction; `shippable`
  and `hostNames`; an acceptance example (4.8, 7).
- 7: per-type fields replaced on a same-binding redeclaration or when no
  live head remains (4.1.2).
- 8: an arm that admits the kind by type wins over a carrier arm (4.2).
- 9: group 1 as the generalized `admitsResidueClassOperand()` (4.2).
- 10: the three engine gates and the `CLASS_FACTS`/`CLASS_SYMBOLS` caches
  named (4.6).
- 11: parameterized and chained nominal kind types refused in phase 1; the
  funnel covers an alias change and a minted constructor (4.1.1).
- 12: the numeric property queries of a kind value answer `undefined`
  (4.3).
- 13: expected types for the `Map` rows, the compile example, `Clamp` and
  `Sort` without `compare` (7, 4.4).

Round 5:

- 1: the numeric sub-sum runs for every kind; the residue `evaluate()`
  change is deliberate (4.4 step 4, 6, 3).
- 2: each kind type contributes its `resultType` answer or itself to the
  cell type, independently (4.5).
- 3, 9: a threadable apply site maps a collection first; a
  collection-parameter apply site enumerates within `maxCollectionSize`,
  never a kind-free, unknown or infinite collection (4.3, 4.4).
- 4: a type redeclaration that invalidates a registered kind type is
  refused (4.1.1).
- 5: `resultType` returns a cell type; the engine derives the shape (4.3,
  4.5).
- 6: a non-strict-recognized operand without a value never joins the
  sub-sum (4.4 steps 2, 4).
- 7: group 1 admits a kind type element-wise in a collection type; the
  `list<residue>` defect fix (4.2, 6, 3).
- 8: the type-only route `deriveApplicationType()` generalized (4.2).
- 10: the `Equal` order: `compare`, the head's `eq`, the structural rule
  (4.4, 3).
- 11: the compile contract is wired in phase 1; the conflict tests (5, 7).
- 12: `.is()` (4.4).
- 13: `Max(U, 3)` is `integer | umeasurement` (4.5, 7).
- 14: the `Negate` operand's index follows the canonical order (4.4).
- 15: D5 cited; a kind on a minted type refused (4.1.1).
- 16: the phase-1 order of the kind dispatch and the name-based branches
  (4.4).

Round 4:

- 1: a disjointness rule for a nominal type defined as exactly `value`,
  beside the subtype rule, both read from the definition (4.1.1, 11, 7).
- 2: the narrowest carrier the parameter admits is substituted (4.2).
- 3: the kind typing applies at group 1, the `apply` sites and the group-2
  operators that name a kind type; `Quantity` answers `number` for the
  trigonometric functions (4.5, 4.7).
- 4: rule 2 derives the shape with placeholders and replaces the cells, as
  `residueShapedResultType()` does (4.5).
- 5: the registry is covered by the checkpoint model (4.6, 11).
- 6: the inventory's second part, the group-3 operators probed with a real
  and a complex measurement; the domain-edge cases (8, 6).
- 7: `value`/`any` out of the group-3 list; an apply site is defined by an
  operand admitted only through the carrier; the comparisons, `Max`, `Min`,
  `Sort`, `Clamp` are never apply sites (4.2, 4.3, 4.4).
- 8: the static type of `Max`/`Min`/`Clamp`/`Sort` and of an `apply` site
  with a collection operand (4.5).
- 9: `Equal`/`NotEqual` fall back to the `eq` rule when no pair is
  comparable (4.4).
- 10: a user operator over `real` becomes an apply site; the way to keep
  its handler (4.4, 6).
- 11: the per-type agreement rule made precise (4.1.2).
- 12: the dispatch part of the registry is keyed by the bound definition
  (4.6).
- 13: a finite collection is enumerated once into `ops.elements(i)`; an
  infinite or unknown-length one is left to the handler (4.3, 4.4).
- 14: `r + 1` boxed before registration stays an error (4.6, 7).
- 15: chains, `Sort`, `Clamp` (4.4).
- 16: a `value`/`any` parameter folds `x/x` too (4.2).

Round 3:

- 1: a kind without `compare` stays unevaluated at the relational
  operators and is an error at `Max`/`Min` through the generalized type
  handler; `Max`/`Min` and the relational operators admit through group 2
  (4.2, 4.3, 4.7); rows added (3).
- 2: the rule for an `unknown` parameter, binders, and the definition of
  "a function with a body" (4.2); rows for `Sum` and `Map` (3).
- 3: `apply` fires for a collection operand whose elements include a kind
  value; the `statistics.ts` branches become `apply`; group-2 numeric
  handlers decline (`GCD`) (4.3, 4.4, 4.7).
- 4: the `simplify()` barrier uses the non-strict reading; the strict
  reading is for the compile boundary only (4.6).
- 5: a fold may absorb another kind's value; precedence by order of first
  occurrence; `Q · M` in both orders (4.3, 4.4, 3).
- 6: the zero-uncertainty collapse is removed, a deliberate change
  (4.7, 6); no measurement `resultType`.
- 7: the default result type derives the operator's own result over the
  kind-free arms (4.5).
- 8 (decision D): `Measurement` is `'number'`, a `'number'` kind is also
  admitted where `real` is, `apply` refuses a complex nominal at
  evaluation (4.2, 4.7, 6).
- 9: one `compare` for every use, by nominal for a measurement; `Max` of
  measurements now decides (a deliberate change, 6); `Equal` calls
  `compare` with at least one kind operand (4.3, 4.4, 10).
- 10: the 4.5 rule applies at every operator with a kind operand;
  `Abs(-2 m)` typed `quantity` (4.5, 4.7, 3).
- 11: `resultType` is per type; the agreement rule covers it (4.1, 4.1.2,
  4.3).
- 12: a nominal type defined as exactly `value` is `<: value` by the
  definition rule, the `object` precedent; 4.1.2 requires that definition
  (4.1.1, 4.1.2, 10, 11).
- 13: a kind registered after the bootstrap joins the engine for its type
  (4.6).
- 14: the comparison methods and `exactOrder()` go through `compare` (4.4,
  11).
- 15: group-1 admission reads "any registered head of the type"; at boxing;
  not revisited (4.2).
- 16: `resultType` receives `'Power'` for `Sqrt`/`Root`/`Square` (4.3).
- Process: phase 1 starts when a round reports no high finding against it;
  the phase-2 inventory (5, 8).

Round 2:

- 1, 2 (decision A): a kind type is a subtype of `value` (4.1.1); the
  arithmetic operators admit a kind by rule, from the registry, not by a
  literal in a signature (4.2, group 1); the `Quantity` operator list
  completed (4.7); the `GF8` test kind (4.10, 7).
- 3, 4 (decision B): a function with a body admits a kind only when its
  parameter admits it by type; `apply` is never called at a function with a
  body (4.2, 4.3); the `x/x` fact recorded (1, 4.2).
- 5 (decision C): the `compare` hook (4.3, 4.4); `measurementNominal()` and
  `quantityCompare()` become `compare` (4.7, 11).
- 6: numeric arms kept for possibly-kind operands; `resultType` (replacing
  `applyType`) covers the arithmetic operators too; `Quantity` answers
  `number | quantity` (4.5, 4.7).
- 7: the refusal examples corrected (`Factorial`, `Mod` admit a
  measurement; `finite_real` is `real`; `non_negative_real` is not a type)
  (4.2, 6, 7).
- 8: `Sin(2 m)` admitted at boxing and unevaluated, `Sin(2 deg)` folded
  (4.7, 3).
- 9: the `simplify()` barrier covers every subexpression that holds a kind
  value (4.6).
- 10: the engine-join events named; result and parameter types excluded
  (4.6).
- 11: the public methods route through `residueArithmetic()` generalized
  (4.4, 11).
- 12: the conflict rule for the binary operators, `apply` and the compiled
  dispatch (4.4, 4.8).
- 13: an absent `apply` runs the handler; `undefined` leaves the expression
  (4.3, 4.4).
- 14: a redeclaration without the field removes the dispatch entry (4.6).
- 15: a plain-number fold value joins the numeric sub-sum; a new kind's
  value is placed without another pass (4.4).
- 16: the phase of the compile message (3).
- The user's choices: the field is `arithmetic`; `residue` stays `'none'`
  (4.2, 10).

Round 1:

- 1, 19: `apply` runs only at admission sites; an absent `apply` runs the
  operator's handler; the exponents of `Sqrt`/`Root`/`Square` and the
  `written` form of `Subtract` are stated (4.3, 4.4).
- 2: `resultType` and the result-type order of 4.5; acceptance rows for
  `Less`, `Floor` and a dimensionless quotient (3).
- 3: "nominal" replaced by "kind type: a kind primitive or a nominal type"
  (4.1.1); the library kinds are primitives, user kinds nominal, same
  capabilities (4.10); public `mint: false`.
- 4: `exact(i)` on the operands, the purity rule, the hook numericizes its
  result (4.3).
- 5: the carrier substitution for union arguments (4.2).
- 6: the compile contract split per type and per head (4.8).
- 7, 13, 15: the fold contract (several folds, index space, `written`
  alignment, the numeric sub-sum of the remainder, re-entrancy, errors)
  (4.3, 4.4).
- 8: the engine-level registry, the generation counter on the recognition
  cache, the pre-pass rollback (4.6).
- 9: the enclosure contract of the `interval-js` lowering (4.8).
- 10: the declaration check stated positively (4.1.2).
- 11, 12: admission at user functions and binders, the `isSubtype('real', P)`
  definition, the list of refusals (4.2, 6).
- 14: phase 0 (5), done.
- 16: recognition descends into collection element types (4.6).
- 17, 18: the expected columns of section 3; the phase-1 mechanism tests (7).
- 20: `Quantity` is `admittedAs: 'none'` with explicit `quantity` parameters
  (4.7); the question is closed.
- 21: the branch count (1).

## 13. Phase-2 decisions (the user, 2026-10-26)

The phase-2 inventory (`docs/scratch/2026-10-26-value-kinds-phase2-inventory.md`,
section "Decisions needed") put 16 questions; the user took every
recommendation. They are the rules of phase 2, and they override section 3
and section 6 where those differ:

1. A step function (`Floor`, `Ceil`, `Round`, `Truncate`, `Sign`,
   `Heaviside`, `PrimePi`) of a measurement propagates to first order (an
   uncertainty of 0, so with decision 3 the bare value, as today), and stays
   UNEVALUATED when a jump of the function lies within one σ of the nominal
   (`Floor(2.95 ± 0.1)`, `Sign(0 ± 0.1)`). The row `Floor(Measurement(2.5, 0.1))
   → Measurement(2, 0.1)` of section 3 is withdrawn: the answer is `2`.
2. `Mod` and `Fract` propagate to first order (`Mod(5 ± 0.1, 3)` is
   `2 ± 0.1`, `Mod(7, 3 ± 0.1)` is `1 ± 0.2`), with the same near-jump rule.
3. The zero-uncertainty collapse of the `Measurement` constructor stays
   (decision of 2026-07-07): a hook result can be a plain number, and the
   measurement kind declares `resultType` `number | measurement` for the
   operators where that can happen. The section-6 change "`Cos(0 ± 0.1)` is
   `1 ± 0`" is withdrawn: `Cos(0 ± 0.1)` is `1`.
4. An infinite derivative or an infinite value (`Sqrt(0 ± 0.1)`,
   `Arcsin(1 ± 0.1)`, `Ln(0 ± 0.1)`, `Gamma(0 ± 0.1)`, a pole) leaves the
   call unevaluated (today: the bare value).
5. A real measurement whose value is not real (`Arccos(2.5 ± 0.1)`,
   `Ln(−1 ± 0.1)`) gives `f(a) ± |f′(a)|·σ` (today: the bare complex value).
6. A complex nominal at an operator that admits complex numbers gives
   `f(a) ± |f′(a)|·σ` for every operator with a derivative (today:
   inconsistent, CE-508.12).
7. Of the 21 operators that compute a value today through the hooks and
   that `apply` would not know: those where the measurement appears once in
   each result cell (`Hypot`, `Dot`, `Cross`, `MatrixMultiply`,
   `HadamardProduct`, `Trace`, `Norm`, `Distance`, `Degrees`, `Haversine`,
   `PreIncrement`, `PreDecrement`) name `measurement` in their parameter
   type (group 2), so their handler runs as today; `apply` uses the symbolic
   derivative `D` where the engine has one; `Binomial`, `Choose`,
   `Pochhammer`, a determinant by cofactors, `Inverse`, `Eigenvalues` and
   the like stay unevaluated (the hooks would treat repeated occurrences of
   one measurement as independent); `ContinuedFraction`, `ComplexRoots`,
   `Arg`, `Argument` stay unevaluated. Never "the handler runs through the
   hooks" for a repeated occurrence.
8. `ElementMax` and `ElementMin` are comparison sites (the `compare`
   dispatch, element-wise), like `Max` and `Min`.
9. The phase-1 admission gaps are fixed: a parameter typed by a type
   variable bounded by `number` (`Conjugate`, `Chop`, `Remainder`,
   `BaseForm`), the `Rational` overload, and the `number` parameters of
   `Exp2`, `ND`, `NIntegrate` admit a `'number'` kind through the carrier; a
   matrix of measurements is admitted at the matrix operators (element-wise
   carrier), and decision 7 says what each one does.
10. `Clamp(x, lo, hi)` returns `x` when `x` equals a bound (`3 ± 0.1`, not
    the bound `3`).
11. A complex measurement compares as its nominal: `Less((2 + 3i) ± 0.1, 3)`
    is `False`, as `Less(2 + 3i, 3)` is; the relational operator applies to
    a `compare` that declines the rule it applies to a complex literal.
12. A tie in `Max`/`Min` keeps the first operand: `Max(2 ± 0.1, 2)` is
    `2 ± 0.1` (today `2`).
13. `ArithmeticDefinition` gains an optional `isExact(value)` field; the
    `NaN`/`Indeterminate` rule (`isInexactOperand()`, `nanOperandAnswer()`)
    reads it for a kind value (a measurement is inexact; a quantity is as
    exact as its magnitude).
14. `.re` and `.im` of a measurement are `NaN` (section 4.3); listed in
    section 6 as a visible change.
15. All 24 trigonometric heads name `quantity` (the angle fold then applies
    to `Arctan` as to the others), and `Abs` does; `Hypot` does not (a
    feature for later).
16. A ranged parameter (`NormalDistribution`, `Quantile`, the distribution
    constructors) refuses a measurement after phase 2 (nothing is lost:
    those calls stay unevaluated today).

The six wrong values the inventory found are CE-508.7 to CE-508.12.

### 13.1 Amendments from the review of the inventory (2026-10-26)

The dual review of the inventory (`docs/scratch/2026-10-26-value-kinds-phase2-inventory_SPEC_REVIEW.md`,
24 findings) refines the decisions above. These amendments are part of the
phase-2 rules:

- **A1** Decision 3 is an explicit amendment of 4.7 and section 6: the
  zero-uncertainty collapse stays in the constructor AND in the hooks
  (`makeMeasurement()`); the measurement kind declares `resultType`
  `number | measurement` at every operator where a hook can give a plain
  number (the apply sites, `Power`, `Multiply`, `Divide`, `Im`/`Imaginary`).
  The section-6 line "`Cos(0 ± 0.1)` is `1 ± 0`" is withdrawn.
- **A2** The step rule of decision 1 applies to a REAL nominal only. A
  complex nominal at `Sign`, `Floor`, `Ceil`, `Round`, `Truncate` leaves the
  call unevaluated (complex `Sign` is `z/|z|`, not zero-slope).
- **A3** Propagation with several uncertain operands, real or complex, is the
  quadrature of non-negative terms `|∂f/∂xᵢ|²·σᵢ²` (today the complex
  helpers square complex partials and contributions cancel, CE-508.14):
  `Multiply(1 ± 0.1, i ± 0.1)` is `i ± 0.1414`.
- **A4** `power` with an uncertain exponent and a base that is not provably
  positive never returns the bare nominal (CE-508.15): for a real base
  `b ≠ 0`, `b^a ± |b^a·ln|b||·σ_a`-style propagation with the principal
  logarithm where the value is defined; otherwise unevaluated.
- **A5** The logarithm aliases (`Ln`, `Log`, `Lb`, `Lg`, `Log2`, `Log10`),
  `Sqrt`, `Root` and `Power` with a complex base give `f(a) ± |f′(a)|·σ`
  with the correct complex nominal (today `Log2((2 + 3i) ± 0.1)` is `1`,
  CE-508.13).
- **A6** `compare` gains a fourth answer, `'unordered'`: the two values are
  not ordered but are not "unknown" either; the four order operators answer
  `False`, and `Equal`/`NotEqual` fall to the kind's `eq`. `Measurement`
  declares `eq` by nominal (with the engine tolerance for floats; a complex
  nominal compares as a complex number): `Equal((2 + 3i) ± 0.1, 2 + 3i)` is
  `True`, `Less((2 + 3i) ± 0.1, 3)` is `False` (decision 11, without a
  name-based fallback). `ArithmeticDefinition.compare` returns
  `-1 | 0 | 1 | 'unordered' | undefined`.
- **A7** The quantity `compare` keeps the finer-unit tolerance policy of
  `quantity-compare.ts` (`Equal(1 m, 100.0000000001 cm)` stays `False`;
  CE-508.10 is not a defect). The zero tolerance of today's extrema goes
  (section 6).
- **A8** Decision 7: `apply` propagates through the partial derivatives
  wherever they are known in closed form, including `Hypot`, `Dot`, `Norm`,
  `Distance`, `Cross`, `MatrixMultiply`, `HadamardProduct`, `Trace`,
  `Degrees`, `Haversine`, `PreIncrement`, `PreDecrement` (implemented in the
  measurement `apply`, not by running the handler through the hooks); an
  operator names `measurement` in its parameter only when no closed partials
  exist, and then its handler validates the nominal (complex at a real-only
  parameter → `incompatible-type`) and its declared result type becomes
  `real | measurement`. `Binomial`, `Choose`, `Pochhammer`, a determinant by
  cofactors, `Inverse`, `Eigenvalues`, `ContinuedFraction`, `ComplexRoots`,
  `Arg`, `Argument` stay unevaluated.
- **A9** Static types follow 4.5 everywhere: `Clamp(M, 0, 3)` is
  `integer<0..3> | measurement`-shaped (the union), a lazy operator keeps its
  own type.
- **A10** A literal matrix with kind cells is typed with its dimensions
  (`matrix<(integer | measurement)^(2x2)>`-shaped), so the matrix operators
  admit it, and `Determinant([[M, 2], [3, 4]])` equals
  `Determinant(Matrix([[M, 2], [3, 4]]))` (a phase-1 defect in the literal
  typing of kind cells).
- **A11** Every numeric parameter propagates, not only the first: an
  uncertain `Log` base, `Round` step, `Root` index, `Norm` order, and
  several uncertain operands (`Log(2 ± 0.1, 3 ± 0.1)`, `Hypot(M1, M2)`).
- **A12** The acceptance table includes the CE-508 rows under `simplify()`,
  `Supremum`/`Infimum`, the reducers (`Sum`, `Product`, `Reduce`)
  and the public methods (`M.add(M2)` is `5 ± 0.141`, `q.add(30 cm)` is
  `2.3 m`, route parity with `ce.function(…).evaluate()`).
- **A13** Decision 4: a decline is only for an infinite VALUE or DERIVATIVE
  at the nominal; a nominal whose numeric kernel is missing (`LogIntegral`
  of a complex nominal) keeps a symbolic nominal with its finite propagated
  σ. The `power` hook declines for `Sqrt`/`Root` at 0, `apply` for the
  others. A float nominal near a pole (`Tan(1.5707963 ± 0.1)`) gives the
  large finite value with its large σ; the symbolic pole (`Tan(π/2 ± 0.1)`)
  is unevaluated.
- **A14** A parameter typed by a type variable bounded by `number`
  (`(T) -> T where T: number`): the carrier checks the bound, and the call is
  typed by 4.5 (the kind arm), not by `T`.
- **A15** The public methods `.add()`, `.mul()`, `.neg()`, `.sqrt()`, … fold
  kind values after phase 2 (today they do not): a visible change of
  section 6.
- **A16** Temperatures with an offset are acceptance rows: `20 degC − 5 degC`
  is `15 K`, `20 degC + 5 degC` is `571.3 K` (today's values, kept), a
  difference with a third term, `.N()`, `Negate(20 degC)`, a mix of degC and
  K, a quantity with a measured magnitude; the `add` hook reads `written[i]`
  for the sign.
- Also: exact nominals (`Sin(Measurement(1/3, 0.1))` keeps `Sin(1/3)` under
  `evaluate()` and numericizes under `.N()`), a bigint nominal, a
  measurement inside a list broadcast (`Sin([M, 3])`), the routes outside
  the library (a symbol declared `real`, a symbol inferred `real` by a use,
  `f: (real) -> real` with a body, `h` with a handler, `compile()` declines,
  an Epsil `let r: real = 2 ± 0.1`), quantity collections (`Sum([2 m, 4 m])`
  is `6 m` typed `quantity`, `Max([2 m, 4 m])` is `4 m`), and `Round`/
  `Floor`/`Sign` of a quantity becoming refusals, are acceptance rows. The
  snapshot blast radius is MEASURED in the worktree after the type change
  (not estimated). The Tycho and Epsil sources are grepped for
  `declareType('measurement'|'quantity')` before landing.

### 13.2 Decision 14 reversed (the user, 2026-10-26)

`.re` and `.im` of a measurement KEEP the nominal (`Measurement(2.5, 0.1).re`
is `2.5`; a complex nominal gives its parts). Tycho reads `expr.re` of every
quadrature result (`src/plot-core/classification-numeric.ts`,
`getNumericValue()`), and `NaN` there would make every integral row `null`.
The protection of a kind value from canonical folds rests on the FACT queries
(`isPositive`, `isNegative`, `sgn`, `isInteger`, `isFinite`, …), which stay
`undefined` for a kind value (4.3); the wrong-value route of a kernel reading
`.re` is closed by the `apply` dispatch, which runs before the handler at
every admitted operator. The rule of 4.3 for `re`/`im` applies to the other
kinds; a kind whose values stand for a number may project it through
`re`/`im`. Section 6's "`.re` is `NaN`" line is withdrawn.
