# CE-1109: a canonical call is recognized by its definition, not by its name

**Status:** started 2026-11-07 by the user (session compute-engine-7c). The
ROADMAP entry was removed when the work started; this document holds its
content and the state of each sub-item. CE-1109.4 changes a documented
contract (`docs/SCOPING-MODEL.md`, "Callable resolution": two calls of the
same name with the same operands are `isSame` whatever they are bound to,
accepted 2026-10-30), so its code waits for the user's approval of its spec.
Related: the `Module` operator and `std::name` (commit `acf5a9183`, plan
`docs/plans/2026-11-07-ce1099-std-module.md`).

**Witness:** plausible; the limits that `std::name` documents
(`src/epsil/docs/naming.md`, "The qualified name `std::name`"): where the
program binds the capitalized library name, a qualified call of an ordinary
library function is applied to the values of its arguments with no symbolic
simplification, and a qualified call of a library function that holds or
binds an argument, or with a named argument, is the error
`qualified-call-shadowed`. Both limits exist only because the engine
recognizes a call by its name.

## The rule

A canonical call denotes its definition (`operatorDefinition`), and a library
rule (a canonical fold, a simplification rule, a derivative table, a compiled
lowering) is a fact about the library operator, so it applies to a node only
when the node is bound to that operator. A test of `node.operator` against a
name is a pre-filter; the decision compares the node's definition with the
definition of the name in the system scope
(`ce._evalContextStack[0].lexicalScope.bindings.get(name)`, one map read), or
the definitions of two nodes with each other. This is cheaper than the guard
in use before this item, `shadowsLibraryName(ce, name)`
(`library-shadowing.ts`), which reads `ce.contextStack` (a copy of the stack on
each read) and walks `lookupDefinition()`. It also answers for the scope where
the node was bound, where the guard answers for the current scope, which is
another scope for a node made before a shadowing declaration or inside a
qualified call.

## Measure

The count of `.operator === '<Name>'` tests in `src/` was 1,473 in 186 files,
and about 100 sites used the scope-based guards (`shadowsLibraryName()`,
`isShadowedSymbol()`, `shadowedLibraryNames()`, `libraryNamesShadowedIn()`);
both counted with `/usr/bin/grep` on 2026-11-07. Only the guarded sites and the
sites of CE-1109.3 and CE-1109.4 change. A raw name test inside a handler that
the node's own definition selected (the `evaluate` handler of the library
`Sin` tests `this.operator`) is correct and stays. A raw name test on an
OPERAND in such a handler is the risk; it is changed on a `corpus` or
`plausible` witness, as an issue.

**Timing.** Each sub-item that changes a canonical or simplification step is
timed before and after with one script, so that the numbers compare: the
canonical boxing and the `simplify()` of the corpus
`SIMPLIFY_CORPUS_FLAT` (`test/compute-engine/rule-dispatch-corpus.ts`), and
`benchmarks/effects-registration.ts` (the canonicalization corpus that
`benchmarks/README.md` names). The results are in "State" below.

## Sub-items

- **CE-1109.1** The predicate, in `library-shadowing.ts`:
  `isLibraryOperator(node, name?)` is true when `node.operator` is `name`
  (when given) and `node.operatorDefinition` is the system-scope definition
  of that name, or an extension or a copy that keeps its handlers
  (`extendedLibraryOperator()`, `keepsLibraryOperator()`); and
  `sameOperator(a, b)`, true when the two nodes have the same
  `operatorDefinition`. A node with no binding (a raw or structural node)
  falls back to the scope-based guard. Write the rule above in
  `docs/SCOPING-MODEL.md`, "Symbol identity", and a line in
  `CODING-STYLEGUIDE.md` on how library code recognizes a library call.
- **CE-1109.2** Migrate the guarded sites that test a canonical node to the
  predicate on the node. Keep the scope-based guard where the node is not
  bound yet (the canonical short paths of `box.ts` that run before the node
  exists, such as the `Rational`, `Complex` and `Negate` folds at the top of
  the boxing of a function). Measure the time of the simplify and
  canonicalization benchmarks before and after.
- **CE-1109.3** The canonical steps that compare an operand with the node by
  name compare definitions: the idempotent and involution fold (`box.ts`,
  "4/ Apply `idempotent` and `involution`", `args[0].operator === name`
  becomes `args[0].operatorDefinition === opDef`), the associative flatten
  (`flatten()`, `boxed-expression/flatten.ts`, called with a name), and the
  statement-position check of the `BoxedFunction` constructor
  (`withoutStatementOperands`, for `If`).
- **CE-1109.4** The rule matcher and equality. In `matchOnce()`
  (`boxed-expression/match.ts`), a pattern head that is a library name
  matches only a node bound to the library operator. This covers the rule
  sets applied through the matcher (Rubi, Fungrim, the solve tables, a
  caller's rules); most default simplification rules are functions that do
  not use the matcher, and the opaque-name mask of `simplify()` stays for
  them. `same()` (`boxed-expression/compare.ts`) compares the
  definitions of two calls, as `isSameCall()` (`boxed-function.ts`) already
  does, so a user call and a library call of the same name are no longer
  `isSame`, and canonical `Add` no longer merges them into one term. The hash
  stays by name (a collision is allowed). Spec first.
- **CE-1109.5** Remove the two limits of `std::name`. With CE-1109.1 to .4
  done, `qualifiedCallForm()` (`function-utils.ts`) gives the plain call
  bound to the library definition in every case: the `Apply` form of a
  shadowed qualified call, the error `qualified-call-shadowed`, their
  diagnostics and their documentation (`src/epsil/docs/naming.md`,
  `docs/SCOPING-MODEL.md`) go. This needs a way to build a call bound to a
  given definition without a borrowed scope: today `withBorrowedBinding()`
  (`binders.ts`) and `callableApplication()` (`function-utils.ts`) make the
  NAME resolve to the definition in a temporary scope, so every name test of
  the operands sees no shadow, which is what made the `Apply` form necessary.
  A `definition` option of the `BoxedFunction` constructor
  (`boxed-function.ts`, which takes none today) is the candidate. Then the
  compiler can lower a shadowed library call by the node's definition
  instead of declining (`compile-definitions.ts`; the decline is decision D6
  of the CE-1099 plan).

## State

- CE-1109.1: done 2026-11-07 (uncommitted). `isLibraryOperator()` and
  `sameOperator()` in `library-shadowing.ts`, 17 tests in
  `test/compute-engine/library-operator-identity.test.ts`. Three points
  differ from the text of the sub-item above. (1) A call bound to a value
  definition (a function made with `DefineFunction` or an Epsil `function`,
  whose head is a variable) is not a library call: it has no operator
  definition, and the fallback to the scope guard would call it a library
  call after its scope is popped. (2) `sameOperator()` compares
  `operatorDefinition ?? valueDefinition`, so a library call and a call of a
  `DefineFunction` function of the same name are two operators. (3) A
  structural node is bound (the `BoxedFunction` constructor binds it), so the
  predicate reads its definition; only a node with no definition falls back
  to the scope guard. A caller library cannot redefine a standard name (the
  engine reports a duplicate definition), so `customLibrary` concerns only
  names that a caller library adds.
- CE-1109.2: done 2026-11-07 (uncommitted, not reviewed yet). A new helper
  `shadowsLibraryOperator(node)` is the node form of `shadowsLibraryName()`
  (true only for a library name whose node is not bound to the library).
  Sites moved to the node: the simplification mask (`simplify.ts`, which now
  also binds the shadowed names back to the library while it simplifies,
  because rules build their results by name), the derivative table, the
  definite, piecewise and discrete integration walks, `calculus.ts`, and the
  compiler in part (a node bound to the library or to a user operator
  definition is judged by its node; other nodes by the current scope,
  because the compiler reads block locals and parameters by name). The sites
  that run before the node exists, or that name a function in a new result
  (`Pi` in a result, the names of a result of an integral), keep the scope
  guard. Wrong values fixed: a user `Sqrt` node simplified after its scope
  ends (`Sqrt(y²)` gave `|y|`, `Sqrt(y)·Sqrt(y)` gave `y`), a user `Sqrt`
  with an `evaluate` handler compiled after its scope ends (gave 2, not 104;
  now declines); a library `Sqrt(y²)` simplified in a shadowing scope is now
  simplified. Tests: `test/compute-engine/library-operator-identity-sites.test.ts`.
  Timing (one lock window, load 6.2): boxing 61.4 → 57.5 ms, simplify
  74.59 → 70.26 ms, same fingerprint; registration 49.6 → 52.3 ms with
  overlapping minima and maxima; within the noise. Kept: inside a local scope
  that binds the name (a parameter `Sin`), every node of the name is masked;
  the `trig` strategy writes no new `Sin`/`Cos` call where the user's scope
  shadows the name.
- Review of CE-1109.1 to .3 (Claude and Codex, three rounds, 2026-11-07).
  Round 1: the compiler declines a call whose definition is not the one the
  emission reads by name (`compileReadsOtherDefinition()`); the mask is built
  before the library bindings are restored; the derivative and integral
  rules do not apply to a library call while a call head built in the
  current scope reads a user function of its name (`libraryRuleBlocked()`),
  because they build their result by name, and `shadowedCallsIn()`
  (`calculus.ts`) leaves such an integral unevaluated. Round 2: a blocked
  library call leaves the `D` unevaluated (the form
  `Apply(Derivative(f, 1), x)` evaluates `f` by name); `libraryRuleBlocked()`
  skips a binding that cannot be applied, so a user value `Gamma := 1.4`
  does not block the rule for `Gamma(x)`. Round 3: a blocked call that does
  not depend on the variable has the derivative 0. Open, older code: a rule
  whose result names ANOTHER shadowed library function (the derivative of
  `Arcsin` names `Sqrt`) is CE-1114; the evaluation of `Add` and `Multiply`
  in a shadowing scope binds a library operand again by name (CE-1118).
- CE-1109.3: done 2026-11-07 (uncommitted, not reviewed yet). The idempotent
  and involution fold already compared definitions (commit `acf5a9183`).
  `flatten()` (`flatten.ts`) takes a name, which means the library operator,
  or a call, whose definition must be the operand's (`sameOperator()`); the
  callers in `box.ts` and `hold.ts` pass the definition. The statement check
  of the `BoxedFunction` constructor and `_computeStructural()` read the
  operand's definition. Wrong values fixed (each with a user function of the
  library name, called inside a library call made in another scope):
  `Chop(Chop_user(1))`, `Xor(Xor_user(T, T), False)`,
  `Add(Add_user(2, 3), 1)`, `And(And_user(T, F), T)`,
  `Union(Union_user(…), …)`, and `Add(AddTo_user(1, 2), 1)`, which was an
  error. Tests: `test/compute-engine/canonical-operand-definition.test.ts`.
  Timing (one lock window, load 7.0): boxing 57.65 → 59.24 ms, simplify
  70.06 → 70.68 ms, same simplify fingerprint, registration 50.2 → 49.4 ms;
  within the noise. Not fixed, older code: the `Multiply` and `Join` canonical
  handlers (CE-1113).
- Checks of CE-1109.1 to .3 on the combined tree: the full suite (1,922
  suites, 81,252 tests passed, 0 failed), and the timing against the base
  in one lock window: boxing 59.04 → 58.28 ms, simplify 71.5 → 71.9 ms, same
  fingerprint, registration 51.1 → 49.4 ms; within the noise (load 30.6 at
  the end of the window).
- CE-1109.4: spec revision 2
  (`docs/plans/2026-11-07-ce1109-4-match-and-same-spec.md`) approved by the
  user on 2026-11-07, with option (a) for its question Q1; CE-1109.5
  approved the same day. Done 2026-11-07.
  `same()` compares the head of two calls of the same name
  (`sameCallHead()`, `compare.ts`) as `sameBinding()` compares a symbol, with
  the library-operator class (`isLibraryOperator()`) in place of the
  root-scope test, so a name that a caller library adds is not merged across
  engines. The matcher admits a subject call for a pattern head that is a
  library name only when the subject is a library call (`headAdmits()`,
  `match.ts`), at the function branch, the three special cases, the five
  variants that read the subject operator, and the anchor tests
  (`sameLiteral()`); `commutativeMatch` of a library name is read from the
  system scope; a repeated wildcard compares bound captures with symbols by
  name and call heads by binding (`sameNamesAndCallHeads()`), so the
  parameter and the `Limits` variable of one `Integrate` still match one
  `_x`; a finite `Range` and the `List` of its integers are the same only
  when both are raw or both are library calls (`sameRangeHead()`), which
  keeps `isSame` transitive.
  The structural form of a call keeps the binding of the call
  (`_withLibraryBinding()`, `boxed-function.ts`, rebuilds in a borrowed
  scope when the build bound another definition). Tests:
  `test/compute-engine/call-identity-is-same-and-match.test.ts` (37). Two
  existing assertions changed (`batch9-misc.test.ts`: a raw sequence capture
  is made canonical before `isSame`; `ce-603-…test.ts`: `q(h_inner(1))` is
  no longer `isSame` to `q(h_outer(1))`), no snapshot. Timing (one lock
  window, load 25.0 at acquire): boxing 64.2 → 62.75 ms, simplify 79.21 →
  77.21 ms, same fingerprint, registration 56.1 → 51.9 ms; within the
  noise. Not fixed, older code: `BoxedFunction.toNumericValue()` reads
  `Sqrt`, `Root`, `Power`, `Abs` by name and rebuilds them by name, so
  `L.add(U)` gives `2·Sqrt(y)` (CE-1122). Review: Claude and Codex, two
  rounds (round 1: the `Range` branch and the repeated wildcard; round 2: a
  reordering of the `Range` test). Full suite: 1,927 suites, 81,326 tests
  passed, 0 failed.
- CE-1109.5: done 2026-11-07. A shadowed
  qualified call is the plain call bound to the library definition, in
  every case; the `Apply` form, the error `qualified-call-shadowed`, its
  Epsil diagnostic, explanation and documentation are gone. Mechanism: not a
  `definition` option of the `BoxedFunction` constructor, because the
  `canonical` handler of a library operator builds its result by name
  (`ce._fn(name, …)`), and an option of the constructor does not reach it.
  Instead, `ce._libraryCall(name, ops)` boxes the call with the option
  `libraryHead` of `boxFunction()`; `boxFunctionInternal()` holds the head
  in `ce._qualifiedHead` while the call is boxed, and clears it while each
  other node (each operand) is boxed. While the head is held, the lookup of
  the head in `makeCanonicalFunctionCore()`, `BoxedFunction._bind()` for a
  node of the name, and `shadowsLibraryName()` for the name read the
  library. So the arguments are canonicalized in the current scope (a user
  `Not` inside `std::Not(…)` stays the user function, an argument `max`
  reads the variable), a lazy operator canonicalizes its operands itself in
  the current scope, and a binder binds its own index (`Sum` declares no
  `k` in the enclosing scope). `qualifiedCallForm()` became
  `shadowsQualifiedName()` (`function-utils.ts`); the `Apply` canonical
  handler uses `ce._libraryCall()` for a library-bound callee symbol of an
  operator, and keeps the `Apply` of a library constant. The compiler still
  declines the call (D6 of the CE-1099 plan), with the interpreter value.
  Tests: `test/compute-engine/qualified-call-library-binding.test.ts`; one
  assertion changed in `module-qualified-name.test.ts` and one `test.each`
  in `test/epsil/std-qualified-name.test.ts`.
  Review (Claude and Codex, three rounds). Round 1: a user function that
  calls the library function of its own name (`function Floor(x) {
  std::floor(x) + 1 }`) recursed, because `ce.assign()` copies the body by
  name (`rawCopyWithSourceOffsets()`, which now writes the `Module` form);
  canonical folds read an operand by name inside the qualified call
  (`Negate`, `Multiply`, relational chains, `Join`: they now test
  `isLibraryOperator()`, which also fixed CE-1113); `canonicalShortCircuit`
  validated with the user definition; a boxed callee gave a binder operands
  already canonical. Round 2: a mark (`markLibraryCall()`) limits the
  rebuild through `_libraryCall()` to nodes bound to a library definition
  that the current scope hides, so an ordinary structural call keeps the
  rebuild by name that `docs/SCOPING-MODEL.md` states; the `Power` and
  `Divide` folds test `isLibraryOperator()`; a callee in parentheses
  (`["Delimiter", ["Module", f]]`) is unwrapped; the error
  `qualified-call-arguments-canonical` is given only for a callee of another
  form applied to an operator that holds or binds an operand. Round 3: only
  the library `Delimiter` is unwrapped, also with the explicit `'()'`
  delimiters; `_bind()` sets the mark, so a rebuild by `subs()` or
  `evaluate()` keeps it. The fixes of round 3 had no review of their own.
  Older defects filed: CE-1133 (`(a/b)^-n` reads a user `Divide`), and
  witnesses added to CE-1118 (`Hold`, `Not`) and CE-1122 (`Sqrt` in a
  product).
