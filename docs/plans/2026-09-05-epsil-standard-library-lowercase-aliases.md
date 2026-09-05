# Epsil standard library: lowercase spellings of the engine operators

**Status:** implemented on 2026-09-05 with option B and the defaults of
section 9 (see section 11 for what was built and what is left).

## 1. Goal

`docs/epsil/ROADMAP.md` (section "Standard library") states the target:

> The signature of each Compute Engine operator is identical in Epsil, but
> the name is an initial lowercase letter instead of an initial uppercase
> letter. For example `sum` is the Epsil operator corresponding to the
> Compute Engine operator `Sum`, and `print` to `Print`. All the MathJSON
> operators are also available in their MathJSON names. However, not all
> MathJSON operators have a lowercase spelling: the "low-level" operators
> that have an alternate syntax in Epsil do not have a lowercase spelling.

Maintainer decisions taken on 2026-09-05:

- Constants get a lowercase spelling too (`pi`, `nothing`, `missing`,
  `goldenRatio`, …). Section 4.6.
- `abs` gets a spelling (the ROADMAP example that listed `Abs` as excluded
  was a mistake).
- The aliasing is preferred as a part of the Epsil LANGUAGE, with no new
  bindings in the Compute Engine, the way `+` maps to `Add` without the
  engine knowing about `+`. Section 3 compares the two mechanisms and
  proposes how to do this.
- `src/epsil/docs/library.md` stays generated, and an expanded reference
  in Epsil syntax, mirroring `doc/*-reference-*.md`, is planned. Section 8.

This plan covers:

1. The audit of the 629 operators and 59 value symbols of the standard
   library, with the list of names that get NO lowercase spelling and the
   reason for each.
2. The mechanism that gives the lowercase spellings its meaning.
3. Tests, documentation, and the measurement of the effect on the existing
   test suite.

## 2. Current state

- `print` and `input` are hand-written operator definitions in
  `src/compute-engine/library/core.ts`. Each one repeats the signature of its
  capitalized operator and has a `canonical` handler that rebuilds the call
  under the capitalized head. This does not scale to 500 operators, and it
  puts an Epsil spelling into the engine.
- The rest of the library has no lowercase spelling. `sin(x)` in an Epsil
  program is an unknown call, reported by the `unknown-function` warning with
  a did-you-mean suggestion (`Sin`).
- `e` and `i` ARE already lowercase constants of the engine (`ExponentialE`
  and `ImaginaryUnit` are bound under `e` and `i` in the system scope), and
  the unit symbols (`m`, `kg`, `s`, `J`, `A`, …) are lowercase engine values
  too. Measured on 2026-09-05 with `executeEpsil`:

  | Program | Result today |
  | :--- | :--- |
  | `e^2` | `e^2` (exact, stays symbolic by the exactness contract) |
  | `i^2` | `-1` |
  | `1 + 2i` | `(1 + 2i)`, a complex number |
  | `let e = 3; e^2` | `9` (the user binding shadows the constant) |
  | `let i = 4; 2i` | `8` |
  | `true && false` | `False` (`true`/`false` are literal words) |
  | `pi`, `missing`, `nothing` | free user symbols (no spelling today) |

  So the behavior the maintainer described for `e` and `i` (`e^2` is the
  exponential, `1 + 2i` is a complex number, a user `e` is possible) already
  holds, through SCOPE rather than syntax. This plan proposes NO lexer rule
  for `e` and `i` (section 4.6 says why).
- `src/epsil/docs/naming.md` documents the OPPOSITE convention: capitalized
  identifiers are library operators, lowercase identifiers are user names.
  That page must be rewritten (section 8).
- Name resolution is scoped. The engine looks a name up from the innermost
  scope outward (`lookupApplicable`, `src/compute-engine/function-utils.ts`).
  A user binding shadows a library binding of the same name. The Epsil
  language server has its own scope-aware walker over the RAW parse tree
  (`src/epsil/occurrences.ts`): it knows `Block`, `Declare`, `Function`
  parameters, `for` loop patterns, `match` patterns, and type declarations,
  and it classifies a name nothing in the document binds as `free`. Rename
  and go-to-definition are built on it.

## 3. Mechanism

### 3.1 What makes this different from `+`

`+` maps to `Add` in the Epsil parser and the engine never sees `+`. That
works because `+` cannot be a user name. A lowercase identifier CAN be a
user name: `let sum = 0` must make `sum` a variable, `function mean(xs)`
must make `mean` a user function, and a parameter `count` must not turn into
the `Count` operator inside its body. So whichever layer owns the alias must
resolve it BY SCOPE. There are two candidates for that owner.

### 3.2 Option A: alias bindings in the engine

At engine construction, bind each lowercase spelling in the system scope to
the SAME definition object as its capitalized name. Boxing normalizes the
head to the canonical name, so a boxed expression never carries `sin`.

- Scope resolution is the engine's own. Every binder form is covered,
  including operators that declare their own binding sites with a `scoped:`
  selector (`Sum` indices, comprehensions). No parity risk.
- Hover, go-to-definition, `epsil doc`, the MCP server, and the static
  checks work with no change: they all go through the scoped lookup.
- Cost: about 560 new bindings visible to every engine user.
  `ce.lookupDefinition('mean')` answers `Mean` for a MathJSON caller who
  never heard of Epsil; `["Add", "mean", 1]` becomes a type error instead of
  a symbolic sum; every loop that enumerates a scope's bindings (ten sites,
  listed in the previous revision of this plan) must learn to skip aliases;
  and the exclusion data, which is about Epsil syntax, must be COPIED into
  `src/compute-engine` (the engine cannot import `src/epsil`) with a test to
  stop the copy from drifting.

### 3.3 Option B: a resolution pass in the Epsil layer (proposed)

The parser keeps producing the raw tree exactly as written (`["sin", "x"]`).
A new pass in `src/epsil/`, `resolveLibraryNames(ast, ce)`, runs between
parsing and boxing. It walks the raw tree with the scope model of
`occurrences.ts`, and rewrites every FREE occurrence of a name that has a
lowercase spelling to the canonical name: `sin` in call position becomes
`Sin`, `sin` in value position (`map(sin, xs)`) becomes `Sin`, `pi` becomes
`Pi`. A name bound by the program (a `let`, a parameter, a loop pattern, a
match pattern, a `function`) is left alone, in the scope of that binding. A
name bound in the ENGINE by an earlier cell or by the host (`ce.declare`,
`ce.assign`, a previous REPL statement) is left alone too: the pass asks
`ce.lookupDefinition(name)` and rewrites only when the answer is nothing or
the system-scope library binding.

- The engine is untouched. No bindings, no MathJSON behavior change, no
  enumeration audit, no copied data: the spelling table lives next to the
  Epsil operator table and the reserved words, where its exclusions come
  from.
- The raw tree keeps the author's spelling, so the formatter, `occurrences`,
  rename, and the raw serialize round trip are unchanged.
- The Epsil serializer can later print `sin(x)` from `Sin(x)` with the same
  table, symmetric with how it prints `+` for `Add` (section 9, decision 1).
- Cost 1, the real one: correctness of shadowing now depends on the binder
  coverage of the `occurrences.ts` walker instead of the engine. Today a
  binder form the walker does not know is a rename bug; after this change it
  is a semantic bug (a parameter named `count` under an unknown binder form
  becomes the `Count` operator). Mitigation: a test that checks the walker
  against the engine's own binder registry, described in section 7, and the
  route-parity tests. The walker is the basis of rename anyway, so it must
  be complete regardless of this plan.
- Cost 2: every Epsil tool that resolves a name by itself must apply the
  same mapping. Sites: the unknown-function scan and the did-you-mean in
  `execute-epsil.ts`, the hover text in `signature-notes.ts`,
  go-to-definition in `definition-sites.ts`, the static checks in
  `static-diagnostics.ts` (they run on the tree AFTER the pass, so mostly
  free), `epsil doc <name>` in `src/cli/doc.ts`, and the MCP server. One
  helper, `canonicalLibraryName(name)`, serves all of them.
- Cost 3: every entry point that boxes a parsed program must run the pass.
  Non-test call sites of `parseEpsil` today: `src/epsil/execute-epsil.ts`,
  `src/cli/session.ts`, `src/cli/check.ts`, `scripts/build-library-docs.ts`,
  `test/utils.ts`, `test/epsil.html`. The pass is exposed from
  `parse-epsil.ts` as a second step (`parseEpsil` stays raw), and each site
  calls it before boxing. A site that forgets gets `unknown-function`
  warnings, not silent wrong answers.

### 3.4 Semantics common to both options

- A free lowercase symbol that spells a library name no longer auto-declares
  as a variable. Today `mean + 1` makes `mean` an unknown number. After the
  change `mean` is the `Mean` operator, and `mean + 1` is a type error, as
  in Python (`sum + 1` raises `TypeError`). The fix for the author is `let
  mean = …`. Section 4.7 lists the names where this is most likely; section
  7 measures how many existing tests it breaks. This is inherent in choosing
  lowercase library names; the layer does not change it.
- `let sum = 0`, `function sum(xs) { … }`, a parameter `sum`, a loop
  pattern `sum`: all shadow the library name in their scope.
- A canonical (boxed) expression carries `Sin`, never `sin`. The raw parse
  tree carries what the author wrote.

### 3.5 Recommendation

Option B, because the maintainer wants the aliasing to be a property of the
language, and because it keeps the engine's MathJSON contract unchanged.
The condition is the binder-coverage test of section 7: if the walker cannot
be made complete against the engine's binder registry, the shadowing
guarantee is weaker than with option A, and the maintainer should know that
before choosing. The hand-written `print` and `input` definitions in
`core.ts` are deleted under either option (under B they would otherwise be
the only two engine-visible aliases).

## 4. Exclusion audit

The audit script (section 10) walks the system scope of a fresh engine,
applies the spelling rule of section 4.5, and sorts each name into the first
bucket that claims it. Counts are from the source tree on 2026-09-05: 629
operator bindings and 59 value bindings.

Under option B, a collision with a TYPE name is no longer a technical
constraint (types are parsed in type position, values in value position), so
the type-name bucket is kept only for the literal constructors that have
their own syntax. The others in that bucket are listed in section 4.6 for a
decision.

### 4.1 Mechanical exclusions (checkable from data)

| Bucket | Count | Names |
| :--- | ---: | :--- |
| Already lowercase | 4 | `distribution` `limits` (type declarations sharing the scope), `print` `input` (hand-written aliases, deleted by this plan) |
| Not a letter | 1 | `__unit__` |
| Single letter | 2 | `D` `N` (`d` and `n` are variable names) |
| Epsil operator table (`src/epsil/operators.ts`) | 25 | `Add` `And` `Assign` `Coalesce` `Divide` `Element` `Equal` `Factorial` `Greater` `GreaterEqual` `KeyValuePair` `Less` `LessEqual` `Mod` `Multiply` `Negate` `Not` `NotElement` `NotEqual` `Or` `Pipe` `Power` `Range` `Same` `Subtract` |
| Hard reserved word (`HARD_RESERVED_WORDS`) | 5 | `Break` `Continue` `Function` `If` `Match` |
| Literal constructor with its own syntax | 5 | `List` (`[…]`), `Tuple` (`(a, b)`), `Set` (`{…}`), `Dictionary` (`{k: v}`), `String` (`"…"`) |

### 4.2 Grammar constructs (Epsil has dedicated syntax) — 45, hand-curated

```
Alternatives Annotated At Block Colon Comprehension Condition Declare
DeclareConformance DeclareProtocol DeclareSumType DeclareType DefineFunction
Delimiter Hold HoldValues HorizontalSpacing IndexedSequence InvisibleOperator
Latex LatexString Loop MatchCase MatchesType MemberCall NamedArgument
OverParen Pair PreDecrement PreIncrement ReleaseHold Rule Sequence Single
Spread Square Subscript Text Triple Typed Unevaluated Which Wildcard
WildcardOptionalSequence WildcardSequence
```

Reasons: statement forms (`let`, `type`, `protocol`, `function`, `if`/`else`,
`match`, loops), literal forms (tuples, `xs[i]`, `...xs`, `x: T`, `name:
value` arguments, `x^2`), parser-internal nodes (`Delimiter`, `Sequence`,
`InvisibleOperator`, `Annotated`, LaTeX islands, spacing), and pattern
nodes (`Wildcard*`, `Condition`, `Alternatives`, `Rule`).

Kept ON PURPOSE, because the function reading is natural even where a
notation exists: `Abs`, `Sqrt`, `Root`, `Exp`, `Ln`, `Log`, `Apply`, `Union`,
`Intersection`, `Subset`, `Superset`, `Divides`, `Implies`, `Equivalent`,
`Congruent`, `IdenticallyEqual`, `Perpendicular`. Epsil has no `|x|`
notation: the `|` token is the sum-type union bar and the match-alternative
separator.

### 4.3 Relation notations (no natural function reading) — 24, hand-curated

```
Approx ApproxEqual ApproxNotEqual NotApprox NotApproxEqual NotApproxNotEqual
NotGreater NotGreaterNotEqual NotLess NotLessNotEqual NotPrecedes NotSubset
NotSucceeds NotSuperset NotSupersetEqual NotTilde NotTildeEqual
NotTildeFullEqual PlusMinus Precedes Succeeds Tilde TildeEqual TildeFullEqual
```

These are LaTeX relation glyphs (`\approx`, `\sim`, `\prec`, `\pm`, …). An
Epsil author reaches them through a LaTeX island. `approx(a, b)` reads
poorly and `tilde(a, b)` means nothing.

### 4.4 Engine-internal heads — 10, hand-curated

```
BuiltinFunction ErrorCode Object Pin Predicate ProtocolMember
ProtocolProperty RuntimeError Signature Subtype
```

Produced by the engine for its own bookkeeping (error payloads, protocol
tables, signature values, the `Object` provenance head that wraps the
serialized snapshot of a mutable object and is not a constructor); not meant
to be called from a program.

### 4.5 The spelling rule

The ROADMAP rule is "initial lowercase letter". Applied literally it gives
`gCD` and `lUDecomposition`. The proposed rule is the usual conversion from
PascalCase to camelCase: lowercase the leading run of uppercase letters, and
when the run is followed by a lowercase letter keep the LAST letter of the
run uppercase, because it starts the next word.

`Sin → sin`, `ArcSin → arcSin`, `IsPrime → isPrime`, `GCD → gcd`,
`LUDecomposition → luDecomposition`, `NDSolve → ndSolve`, `DSolve → dSolve`.

The rule differs from the literal ROADMAP rule for exactly 12 operators:

```
AGM→agm  CDF→cdf  DMS→dms  GCD→gcd  LCM→lcm  ND→nd  PDF→pdf  SVD→svd
LUDecomposition→luDecomposition  NDSolve→ndSolve
NDSolveFunction→ndSolveFunction  QRDecomposition→qrDecomposition
```

Fully lowercased spellings (`arcsin`, `isprime`) are NOT part of this plan.

### 4.6 Constants and value symbols — 59 in the system scope

Get a spelling (the same rule):

```
Pi→pi  Nothing→nothing  Missing→missing  EmptySet→emptySet  Half→half
GoldenRatio→goldenRatio  EulerGamma→eulerGamma  CatalanConstant→catalanConstant
MachineEpsilon→machineEpsilon  ComplexInfinity→complexInfinity
PositiveInfinity→positiveInfinity  NegativeInfinity→negativeInfinity
ImaginaryUnit→imaginaryUnit  ExponentialE→exponentialE
Numbers ComplexNumbers ExtendedComplexNumbers ImaginaryNumbers RealNumbers
ExtendedRealNumbers Integers ExtendedIntegers RationalNumbers
ExtendedRationalNumbers NegativeNumbers NonPositiveNumbers NonNegativeNumbers
PositiveNumbers NegativeIntegers NonPositiveIntegers NonNegativeIntegers
PositiveIntegers  (→ numbers, complexNumbers, …)
SpeedOfLight PlanckConstant StandardGravity ElementaryCharge
BoltzmannConstant AvogadroConstant VacuumPermittivity GravitationalConstant
StefanBoltzmannConstant GasConstant Mu0  (→ speedOfLight, …, mu0)
```

No spelling:

- `True`, `False`: `true`/`false` are literal words of the language already.
- `NaN`: `NaN` is a literal word; the lowercase `nan` is the not-a-number
  TYPE (a legacy read-compatibility row in the serializer).
- `e`, `i`, and the unit symbols `m s kg J A C K F W mol`: already
  lowercase engine values.
- `ContinuationPlaceholder`: engine-internal.

`nothing` and `missing` are also type names. Under option B that is not a
conflict: `x: nothing` is parsed in type position and `nothing` in value
position. Under option A the engine's scope would hold a value binding
`nothing` next to the type `nothing`; the engine keeps types and values in
separate tables, so it is not a conflict there either, but it must be tested.

About `e` and `i`. The maintainer suggested recognizing `e^2` as `exp(2)`
and `2i` as an imaginary literal in the parser, the way `2e10` is a number
literal, with a standalone `e` or `i` staying a user symbol. This plan
proposes NOT to do that, for three reasons:

1. The results the maintainer wants already hold today through the engine
   constants and scope (table in section 2).
2. A lexer rule loses the shadowing: `let i = 4; 2i` is `8` today; with `2i`
   as a literal token it would silently be `2·ImaginaryUnit`. The same for
   `let e = 3; e^2`.
3. A syntactic `e^x` rule and a symbolic `e` would disagree in every other
   position (`e` alone, `e * x`, `ln(e)`), which is harder to explain than
   "`e` is a constant you can shadow".

If the maintainer still wants a syntactic form, the safe one is the number
SUFFIX only (`2i`, `3.5i`, a digit run immediately followed by `i` with no
space), because a number literal can never be shadowed. Section 9, decision
6.

### 4.7 Watch list: spellings that collide with common variable names

These 74 operator spellings (plus `pi`, `half`, `numbers`, `integers` among
the constants) are kept, but each one is a plausible variable name in a
mathematical program. A program that uses one as a FREE symbol changes
meaning (section 3.4). The suite measurement of section 7 counts how often
the existing tests do this.

```
angle arg beta choose chunk count cross cycle degree degrees dimension
distance dot drop field fill filter find first fold gamma head identity im
insert interval join kernel keys last length map matrix max mean measurement
median min mode most norm normal partition polygon position prime product
quantity random rank re rest reverse root second segment series shape sign
slice sort sphere sum table tail take third trace triangle unique values
vector zeta zip
```

### 4.8 Names for a decision (section 9)

- Type-named operators other than the five literal constructors: `Any`
  `Color` `Complex` `Error` `Imaginary` `Rational` `Real` `Symbol` `Type`.
  Under option B a value name and a type name never meet: the parser reads
  a type only after `:`, after `is`, and inside `<…>`, and there is no
  syntax for a bare type in value position (a type value is written
  `TypeFrom("integer")`). Recommendation: give all nine a spelling. `any` is
  the collection predicate (`All` already has one, and Python spells it
  `any`), `type(x)` is the static-type observer, `symbol(…)` builds a symbol
  from names, and `complex(1, 2)`, `rational(1, 2)`, `real(z)`,
  `imaginary(z)`, `color(…)`, `error(…)` read as ordinary calls.
- Six spellings are SOFT reserved words (listed in `RESERVED_WORDS`, not
  consumed by the grammar): `parallel` `repeat` `to` `union` `when` `xor`.
  Recommendation: keep them; if the grammar later claims one, remove the
  spelling then (the drift guard reports it).

### 4.9 Result

| | Count |
| :--- | ---: |
| Operators | 629 |
| Excluded, mechanical (4.1) | 42 |
| Excluded, grammar (4.2) | 45 |
| Excluded, notation (4.3) | 24 |
| Excluded, internal (4.4) | 10 |
| Awaiting a decision (4.8, type-named) | 9 |
| **Operators with a spelling (before 4.8)** | **499** |
| Constants with a spelling (4.6) | 45 |

## 5. Implementation steps (option B)

Work happens in a private worktree (`docs/SHARED-BOX-PROTOCOL.md`); the
deliverable is a diff applied onto the shared tree.

1. **Spelling table.** New file `src/epsil/library-names.ts`:
   `epsilNameOf(canonical): string | undefined` (the rule of section 4.5 and
   the exclusion sets of section 4 as named constants, one full-sentence
   comment each) and `canonicalLibraryName(spelling): string | undefined`
   (the reverse map, built once from the engine's standard library list,
   `STANDARD_LIBRARIES`, which `src/epsil` may import). The exclusion sets
   reference `OPERATORS`, `HARD_RESERVED_WORDS`, and the literal-constructor
   list directly, so there is nothing to copy.
2. **Resolution pass.** New file `src/epsil/resolve-library-names.ts`:
   `resolveLibraryNames(ast, ce)`. Reuse the scope walker of
   `occurrences.ts` (factor its binder handling into a shared walker if it
   is not already reusable) to find free occurrences; rewrite the ones whose
   name has a canonical library name and is not bound in the engine by a
   non-library definition. Rewrite both call heads and value-position
   symbols. Preserve `sourceOffsets` on the rewritten node.
3. **Entry points.** Run the pass in `execute-epsil.ts` (before the static
   pass), `src/cli/session.ts`, `src/cli/check.ts`,
   `scripts/build-library-docs.ts`, `test/utils.ts`, `test/epsil.html`.
4. **Tools.** Apply `canonicalLibraryName` in the unknown-function scan and
   the did-you-mean of `execute-epsil.ts` (suggest `sin`, not `Sin`, when a
   spelling exists), `signature-notes.ts`, `definition-sites.ts`,
   `src/cli/doc.ts`, and the MCP server's describe path.
5. **Delete the hand-written aliases** `print` and `input` from `core.ts`;
   rewrite the comment block above `Print`/`Input`.
6. **Docs generator.** `scripts/build-library-docs.ts` prints the Epsil
   spelling for each entry and a short note for entries that have none.
   Regenerate `src/epsil/docs/library.md`.
7. **Documentation** (section 8).
8. **Tests** (section 7), typecheck, targeted tests, `npm run check:deps`,
   the full-suite measurement.
9. Dual review (`/review-files`) on the changed set; stage.

## 6. Risks

- **Binder coverage of the walker** (section 3.3, cost 1). Mitigation: the
  binder-registry test of section 7.
- **Existing programs and tests that use a watch-list name as a free
  symbol** (section 4.7). Mitigation: the measurement of section 7 gives the
  number before anything lands; the number is reported, not absorbed.
- **An entry point that boxes a raw tree without the pass** (cost 3).
  Symptom: `unknown-function` warnings, never a wrong value.
- **A future Epsil keyword that spells a library name** (section 4.8).
  Mitigation: the drift guard.
- **Performance.** One walk of the raw tree per program, one `Map` lookup
  per symbol node. Not measurable against boxing.

## 7. Tests

New file `test/epsil/library-names.test.ts`:

- Route parity: `sin(1)` evaluates like `Sin(1)`; `print("a")` still
  prints; `map(sin, [0, 1])` boxes as `Map(Sin, …)` and evaluates; `pi`,
  `nothing`, `missing` box to the constants.
- Shadowing, one case per binder form: `let sum = 0; sum + 1` is `1`;
  `function mean(xs) { … }` is called, not `Mean`; `(count) => count + 1`;
  `for count in xs { … }`; `match v { count => … }`; `if let count = …`;
  `while let`; a destructuring `for (p, q) in pairs`; a `Sum` index. Each
  one also on the compiled lane.
- Engine-side shadowing: `ce.declare('sum', 'integer')`, then the Epsil
  program `sum + 1` uses the variable; a previous REPL cell `let mean = 5`
  then `mean * 2` in the next cell.
- Free-symbol behavior of section 3.4, pinned: `mean + 1` with no
  declaration is a diagnosed type error.
- No spelling for an excluded name: `add(1, 2)`, `if(…)`, `list(1)`,
  `d(x)` stay unknown calls (with the diagnostics they have today).
- The formatter keeps `sin(x)` as written; the serializer of a boxed program
  prints `Sin(x)` (until decision 1 of section 9 changes it).
- Tools: `epsil doc sin` describes `Sin`; hover on `sin` shows the `Sin`
  signature; go-to-definition on `sin` resolves; the did-you-mean for `sinn`
  says `sin`.
- Acronym spellings (`gcd`, `luDecomposition`, `ndSolve`).
- **Binder-registry guard:** for every standard operator whose definition
  declares binding sites (`scoped` is set), assert the walker of
  `occurrences.ts` treats those operand positions as binders. Enumerate the
  definitions from `STANDARD_LIBRARIES`; the test fails when an operator
  gains binding sites the walker does not know.
- **Drift guard:** no spelling equals a hard reserved word, a literal word,
  or an Epsil operator-table name; every name in the hand-curated sets of
  sections 4.2 to 4.4 is a real library name (a renamed operator fails the
  test).
- Documentation: `library.md` mentions the Epsil spelling of `Sin` and says
  that `Add` has none.

Measurement: run the full suite once in the worktree (box lock taken), then
sort every failure into "free-symbol collision with a spelling" versus
"other". Report the counts in the delivery message. Do not change any test
to make a collision pass before the maintainer has seen the number.

## 8. Documentation

### 8.1 This round

- `src/epsil/docs/naming.md`: rewrite. New rule: a library name has a
  lowercase spelling (`sin`, `map`, `isPrime`, `pi`) and a capitalized
  spelling (`Sin`, `Map`, `IsPrime`, `Pi`); both name the same thing; the
  lowercase spelling is the Epsil style; a user binding shadows either
  spelling in its scope; the excluded groups of section 4 with a one-line
  reason each; the acronym rule; `e` and `i` as shadowable constants.
- `src/epsil/docs/library.md`: regenerated with the Epsil spelling per
  entry.
- `style.md`, `for-agents.md`, `from-python.md`, `from-mathematica.md`:
  mention the lowercase spelling where the capitalized one is presented as
  the only form. Example programs are NOT rewritten in this round (section
  9, decision 1).
- `docs/epsil/ROADMAP.md`: the "Standard library" section points to this
  plan and to section 8.2 for the remaining documentation work.
- `CHANGELOG.md`: a feature entry for the spellings, and a "Breaking
  changes" entry for the free-symbol behavior of section 3.4 (Epsil
  programs only under option B).

### 8.2 Expanded Epsil library reference (a later round)

`doc/80-…-98j-reference-*.md` are 28 hand-written reference pages for the
MathJSON library, with prose introductions per topic and LaTeX/MathJSON
examples. The maintainer wants the same material in Epsil syntax.

Proposed shape, `src/epsil/docs/reference/<category>.md`, one page per
library category (the same categories `library.md` uses, which follow the
engine's library list):

- **Generated part, per entry:** the Epsil spelling as the heading, the
  capitalized name as an alias line, the signature in Epsil type syntax,
  the full description (not only the first sentence, as `library.md` does),
  and every example from the definition's `examples` field, executed and
  annotated with its value, exactly as `build-library-docs.ts` does today.
  The documentation test keeps executing every block, so the pages cannot
  drift from the engine.
- **Hand-written part, per topic:** the prose sections of the matching
  `doc/*-reference-*.md` page (for example "Trigonometric Transformations"
  in `94-reference-trigonometry.md`), ported to Epsil syntax and kept in a
  companion file that the generator splices in front of the generated
  entries (`reference/<category>.intro.md`), so regeneration never
  overwrites prose.
- **Order of work:** the generator first (it produces a usable reference
  for all 629 operators at once, from existing metadata); then the prose,
  one category at a time, starting with the categories an Epsil author
  meets first (core, collections, arithmetic, control structures, strings).
  Definitions with no `examples` field are the second gap to fill; a count
  per category is the first deliverable of that round.

This is a documentation project of its own and is not part of the
implementation steps of section 5.

## 9. Decisions for the maintainer

1. **Serializer output.** Should the Epsil serializer print `sin(x)` (the
   spelling) or `Sin(x)` (the canonical name) for a boxed expression?
   Recommendation: keep `Sin(x)` in this round. Printing the spelling
   touches every Epsil snapshot and every example in the documentation, and
   needs the reverse scope check (a program with `let sin = 3` in scope
   must not get `Sin(x)` printed as `sin(x)`). If nothing is decided, the
   serializer keeps the canonical name.
2. **Mechanism:** option B (Epsil-layer pass) as recommended in section
   3.5, or option A (engine bindings)? If nothing is decided, option B.
3. **Acronym rule** (section 4.5): `gcd`/`luDecomposition`/`ndSolve`, or the
   literal rule `gCD`/`lUDecomposition`? If nothing is decided, the acronym
   rule.
4. **Relation notations** (section 4.3): excluded as proposed? If nothing
   is decided, excluded.
5. **Type-named operators** (section 4.8): all nine get a spelling
   (`any`, `type`, `symbol`, `complex`, `rational`, `real`, `imaginary`,
   `color`, `error`)? If nothing is decided, all nine do.
6. **`e` and `i`:** keep the engine constants with scope shadowing and add
   no lexer rule, as argued in section 4.6? If a literal form is still
   wanted, the number suffix `2i` only. If nothing is decided, no lexer
   rule.
7. **Watch-list collisions** (section 4.7): accept the "shadow with `let`"
   rule for all of them? If nothing is decided, all are kept and the suite
   measurement reports the cost.

## 10. Audit script

The audit of section 4 was produced by a `tsx` script that constructs an
engine, reads `ce.contextStack[0].lexicalScope.bindings`, applies the
spelling rule, and sorts each name into the buckets above using `OPERATORS`
(`src/epsil/operators.ts`), `HARD_RESERVED_WORDS` and `RESERVED_WORDS`
(`src/epsil/reserved-words.ts`), `PRIMITIVE_TYPES`
(`src/common/type/primitive.ts`), and the three hand-curated sets of
sections 4.2 to 4.4. The drift guard of section 7 replaces the script as the
durable check; the spelling table of section 5, step 1, replaces the
script's hand-curated sets.

## 11. Implementation record (2026-09-05)

Built with option B and every default of section 9:

- `src/epsil/library-names.ts`: the spelling rule (`lowercaseSpelling`), the
  exclusion sets, `epsilNameOf`, and the reverse map `canonicalLibraryName`
  built once from `STANDARD_LIBRARIES` (operators and constants). 551
  spellings.
- `src/epsil/resolve-library-names.ts`: the pass. It reuses the scope
  walker of `occurrences.ts`, which gained an optional `binderNames` hook;
  the pass feeds it the engine's binding-site selectors, so `sum(count^2,
  count in 1..3)` and `integrate(count^2, count)` bind `count`. The pass
  skips a name the engine already binds and the verbatim form.
- Entry points: `executeEpsil`, `checkSource` (the CLI `check` and the MCP
  `check` tool), the library docs generator, and the demo page
  `test/epsil.html`. `parseEpsil` stays raw; `resolveLibraryNames` is
  exported from the `epsil` package for hosts that box the tree themselves.
- Tools: `describeName` (the `epsil doc` command and the hover) describes
  the library name behind a spelling and reports `epsilName`; the
  did-you-mean of `executeEpsil` suggests the spelling and stays silent when
  the spelling IS the unresolved head (a verbatim `` `sin` `` or a shadowed
  `print`).
- The hand-written `print`/`input` definitions are gone from `core.ts`.
- `library.md` is regenerated with an Epsil column; `naming.md` is
  rewritten; the convention passages of `style.md`, `for-agents.md`,
  `from-python.md`, `evaluation.md`, and `implementation.md` are updated.
- Tests: `test/epsil/library-names.test.ts` (29 tests: the rule, the
  exclusions, the drift guards, the pass on every binding form, the
  compiled lane, the tools, the generated page) plus updated did-you-mean
  expectations in `execute.test.ts` and `lints.test.ts`.

Binder coverage, after the dual review: the pass reads the engine's
binding-site selectors (clause-local sites are visible in the body and from
their own clause onward, as the engine defines them), and for operators
that take a variable as a plain operand WITHOUT declaring a site
(`Limit(expr, x, 0)`, `Solve(eq, x)`, the `{x, 2}` order form of `D`) it
applies the rule the engine's own `Limit` handler applies: a symbol that is
a whole operand, or a direct element of a list, set, or tuple operand, and
that also occurs as a value in another operand of the call, is the call's
variable; a name used as a call head anywhere in the call is a function. A
verbatim callee borrows nothing from the library.

Not done, by decision: the serializer keeps printing the MathJSON names;
the expanded reference of section 8.2 is a later round.
