# CE-1109.4: the rule matcher and `isSame` compare the definition of a call

**Status:** spec, revision 2, approved by the user on 2026-11-07, with
option (a) for question Q1 (a library name in a pattern always means the
library function).
Revision 2 applies the dual review of revision 1 (Claude and Codex, 18
findings). Parent: `docs/plans/2026-11-07-ce1109-definition-identity.md`. The
code starts after the approval; it uses `isLibraryOperator()` of CE-1109.1
(done, uncommitted): a node is a library call when its operator definition is
the system-scope definition of its name, or an extension or a copy of it that
keeps the library handlers; never when the name is one that a caller library
(the constructor's `libraries` option) defined; a node with no definition
gets the answer of the scope guard.

This changes a documented contract: `docs/SCOPING-MODEL.md`, "Callable
resolution", says that `isSame()` and the hash compare a call by its name, so
that a call of an outer `h` and of an inner `h` with the same arguments are
`isSame` (accepted 2026-10-30).

## The rule

1. **`isSame`.** Two calls with the same name are the same only when their
   heads are the same binding. The head is compared exactly as `sameBinding()`
   (`compare.ts`) compares a symbol occurrence of that name, with every branch
   of it: the same definition, or a call-frame activation of it; both bound to
   the standard-library definition of the name, each in its own engine; a
   user constant by its value; both the variable of a binder at the same
   position (a parameter `f` in `Function(f(x), f)`). The definitions read are
   the operator definition and the value definition, both, as `isSameCall()`
   (`boxed-function.ts`) reads them: depending on how a function was declared,
   either one can be absent (`ce.assign('f', …)` on a new name gives an
   operator definition; `ce.declare('g', 'function')` then `assign` gives a
   value definition). One more case: two heads that are each the library
   operator by `isLibraryOperator()` are the same, so a call made before
   `ce.declare('Sin', patch, { extend: true })` and one made after it stay
   `isSame`; every member of that class denotes the library function, so the
   relation stays transitive.
2. **Raw heads.** Two calls with no head binding (raw calls) compare by name,
   as today. A raw head and a bound head are different, as a raw symbol and a
   bound symbol already are; otherwise a held `Sqrt(y)` would be `isSame` to
   both a library and a user `Sqrt(y)` that are not `isSame` to each other. A
   structural call is bound (the `BoxedFunction` constructor binds it) and
   follows item 1.
3. **Syntactic mode.** `sameSyntactic()` does not compare head bindings, as it
   does not for symbols: the cycle and progress checks of `simplify()` need
   it, because the simplification boxes its results again with the same
   spelling and other bindings.
4. **Hash.** It stays by name. Two calls that are not `isSame` may have the
   same hash.
5. **Matcher.** `match()` makes the pattern and the subject structural in the
   current scope, so the binding of a pattern head is not read. A pattern head
   that is a library name (a name of the system scope that no caller library
   defined) matches a subject call only when `isLibraryOperator(subject)` holds
   on the ORIGINAL subject node. The flags that the matcher reads from the
   pattern definition (`commutativeMatch`) are read from the system-scope
   definition. A pattern head that is not a library name matches by name, as
   today. The rule applies at every place in `match.ts` that reads a subject
   operator by name, before any variant is built: the function branch of
   `matchOnce()`, its special cases (`Multiply` read as `Divide`; `Divide` and
   `Root` read as `Power`), each branch of `matchVariations()` (`Subtract`,
   `Negate`, `Divide`, `Power` of `ExponentialE` read as `Exp`),
   `matchWithMissingTerms()` and the anchor test for `Add` and `Multiply`, and
   the comparison of a literal sub-pattern with subject operands.
6. **Repeated wildcard.** When a wildcard is captured again (`_x` twice), the
   two subject parts are compared with symbols by name and call heads by
   binding (item 1) when both are bound, and with `sameSyntactic` otherwise
   (a raw part that the matcher built). Today the comparison is syntactic,
   so `Tuple(L, U)` matches `Tuple(_x, _x)` (measured by the review).
   Correction made during the implementation (2026-11-07, review): the first
   version compared the parts with `isSame`, which compares a variable that a
   scoped node of the subject binds as if it were free, so the parameter `x`
   and the `Limits` variable `x` of one `Integrate` no longer matched one
   `_x`.
7. **Structural form keeps bindings.** The structural form of a call keeps
   the binding of the call. Today `_computeStructural()` binds a call again
   by name in the current scope, so a stored user `Sqrt(y)` read after its
   scope ends becomes a library call in `.structural` (measured by the
   review), and the matcher would apply library rules to it.

## Examples

A user function `Sqrt(x) := x + 100` is declared with `ce.declare` and
`ce.assign` in a pushed scope; `L` is `Sqrt(y)` boxed before the push
(library), `U` is `Sqrt(y)` boxed inside. Tests assert the definitions of the
operands, not only the printed form.

| Input | Today (measured 2026-11-07) | Under the rule |
| --- | --- | --- |
| `L.isSame(U)` | `true` | `false` |
| `Add(L, U).simplify()` | `2·Sqrt(y)` (wrong: `U` is `y + 100`) | two terms, one bound to each definition |
| `U.match(Sqrt(_x))` | `{_x: y}` | `null` (see question Q1) |
| `Tuple(L, U).match(Tuple(_x, _x))` | matches | `null` |
| held `Sqrt(2)` against canonical `Sqrt(2)` | `isSame` | not `isSame` (raw head against bound head) |
| `Sin(x)` before and after a `Sin` extension that keeps the handlers | `isSame` | `isSame` |
| `Sin(1)` in two engines | `isSame` | `isSame` |
| user `k(1)` declared in each of two engines | `isSame` | not `isSame`, as a user symbol `k` of two engines already is |
| raw `Sin(1)` and raw `Sin(1)` | `isSame` | `isSame` |
| `sameSyntactic(L, U)` | `true` | `true` |

## What does not change

- **The simplification mask stays.** `simplify()` hides a call of a user
  function with a library name behind an opaque operator before it applies
  its rules (`simplifyShadowedCallsMasked()`, `simplify.ts`). Most default
  rules are functions that test `x.operator` by name (`simplifyLog`,
  `simplifyTrig`, …) and never call the matcher, and the mask also hides a
  user constant with a library name (`GoldenRatio`, `Pi`). So the matcher rule
  protects the rule sets applied through `matchOnce()` (Rubi, Fungrim, the
  solve tables, a caller's rules, `match()` and `replace()`), and the mask
  protects the default rules. CE-1109.2 makes the mask select its occurrences
  by the node's binding instead of by the names of the current scope.
- **A wildcard head** (`_f(_x) -> _f(2_x)`) captures the operator name, and
  the replacement binds that name where the replacement is boxed.
- **Reassignment.** `ce.assign('f', …)` twice keeps the same definition
  (measured), so a call made before and one made after stay `isSame`.

## Question for the user

**Q1. A pattern that the caller bound to a user function with a library
name.** A host that declares its own `Sqrt` and calls `U.match(pattern)` or
`replace()` with a pattern written `Sqrt(_x)` gets no match under item 5: the
pattern head means the library `Sqrt`. Options:

- (a) Accept and document it (recommended). Rule sets are boxed in a scope
  that inherits only from the system scope, so they cannot name a user
  function with a library name in any case; the case needs a program that
  shadows a library name and also writes a pattern for it, which no
  document or request shows (a `crafted` witness).
- (b) When the caller passes a pattern already boxed canonical (bound in the
  caller's scope), read the binding of its head before `match()` makes it
  structural, and match a subject with the same binding. Cost: one more read
  per pattern, and a pattern head means two things depending on its form.

If nothing is decided, (a) applies.

## Cost and trade-off

`same()` gains, for each pair of calls with the same name, the comparison of
two pairs of definition pointers; the other branches run only when the
pointers differ. The matcher gains one map read for a pattern head that is a
library name. Acceptance: the median time of the simplify corpus and of
`benchmarks/effects-registration.ts` (the script and the baseline of
CE-1109.2) grows by at most 3%; a larger cost is reported to the user before
landing.

Precision against simplicity: the rule is the simple, sound version. It never
merges two calls that denote different functions, and it may refuse a match
that the caller meant for a user function with a library name (Q1).

## Steps and checks

1. `same()` and `sameSyntactic()` in `compare.ts`; `matchOnce()`,
   `matchVariations()`, `matchWithMissingTerms()`, the anchor test and
   `captureWildcard()` in `match.ts`; the structural form of a call
   (`_computeStructural()`, `boxed-function.ts`).
2. A new test file with every row of the examples table, plus: the binder case
   (two boxings of `Function(f(x), f)` stay `isSame`), reassignment, an
   extension and a copy of a library definition, a caller library that adds a
   name (two engines with different definitions of it are not `isSame`), one
   test for each matcher site of item 5, the repeated wildcard, and the
   structural form of a stored user call read after its scope.
3. Before landing: the test files of `isSame`, `match`, `replace`,
   `simplify`, canonical `Add` and `Multiply`, and the full suite under the
   box lock (the change is in `boxed-expression/`). Count the changed tests
   and snapshots and report them with the timings.
4. Documentation: `docs/SCOPING-MODEL.md`, "Callable resolution" (replace the
   `isSame` paragraph); the `isSame` limit in
   `docs/plans/2026-11-07-ce1099-std-module.md` §4 (a note that CE-1109.4
   replaced it); the doc comments of `isSame` (`types-expression.ts`), `same()`
   (`compare.ts`), `isSameCall()` (`boxed-function.ts`) and `match()`
   (`match.ts`); the Epsil `IsSame` reference (`src/epsil/docs/`) if it
   describes how calls compare; a CHANGELOG entry; the pages of the guide in
   `~/dev/cortexjs.io/docs/compute-engine/` that describe `isSame` and
   `match()`, if they state the old rule.

## If nothing is decided

The code stays as it is: a library call and a user call of the same name stay
`isSame`, so `Add` can merge them into a wrong term (`2·Sqrt(y)` above), and
the matcher applies the library rules to a user call. CE-1109.5 (the plain
bound call for `std::name`) cannot start, because a plain library call inside
a scope that shadows the name would merge with the user calls of that name.
