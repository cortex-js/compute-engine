# Operand roles declared by the operator definition (issues #513 and #437, CE-811)

Status: done. The user chose form A (the operand-role handler) on
2026-11-05 over a field for statement positions only; revision 3 added the
`held` role, which answers issue #437, and the three-commit plan, approved
the same day. Implemented in `07b044c036f94054d78fd848c189fba8efb7dbba`
(commit 1), `72bfcb782e1f30c8f3a1b1ae9e41b23a19b2b2fc` (commit 2) and
`3ed3595e5cc9e948cebd400a17004cacd50a5b88` (commit 3). Points settled in
the implementation that this text does not say: `opaque` and `raw` are
valid only on a lazy operator, `held` only on a non-lazy one; a non-lazy
operator with a `canonical` handler receives its statement operands already
canonicalized as branches; `PREBOX_OPAQUE_HEADS` stays, because it is read
before any definition lookup; a held literal list of more than 100 elements
is zipped at once, not lazily, when every collection operand has a known
finite count; a `List` of symbols at a `clause` position binds nothing (a
host `Module` binds one name with `Set(k)`, or gives each name its own
`bound` operand); a `bound` variable stays a free variable of the
expression, as `D` and `Series` already had it; `OWN_INDEX_OUTSIDE_BINDERS`
and `FLAT_CLAUSE_BINDERS` stay; the five selector helpers and
`lambdaParamSites` are deleted, and `BindingSite` and `BindingSiteSelector`
are no longer public.
Records: GitHub issues cortex-js/compute-engine#513 (statement operands of
`Do`, `While`, `Module`) and #437 (a `Mod` that reads its first operand
before it is evaluated; Wolfram's `HoldFirst`), ROADMAP CE-811 (a defect of
the current closed list that this change closes).

## 1. The two defects

**Statement operands (#513, CE-811).** Since 0.178.0 an `Assign` or `Declare`
operand is the static error `assignment-in-operand`, except in a statement
position. The statement positions are two closed lists in
`boxed-expression/boxed-function.ts`: `STATEMENT_OPERATORS` (every operand of
`Block`, `Typed`, `Hold`, `Error`) and `isStatementPosition()` (the branches
of `If`, the values of `Which`, the body of `Loop`). A library or host
operator whose operand is a statement has no way to say so, and a `lazy`
definition does not help, because a lazy operator's operands reach the check
raw (`box.ts`, `applyOperatorDefinition`).

Measured on the main tree at `2bf37102d` (`ce.box(json).json`, with `Do` and
`Cell` declared `lazy: true` and no `canonical` handler):

| Input | Today | Proposal |
| --- | --- | --- |
| `Block(Assign(s, 0), Do(Assign(s, s + 1), 5), s)` | `Error(assignment-in-operand, s)` | valid; evaluates to `5` |
| `Do(Assign(s, s + 1), 5)` with `s` undeclared | `Error(assignment-in-operand, s)` | `Error(first-assignment-in-branch, s)` |
| `Cell(Assign(a, 5))` with `a` undeclared | `Error(assignment-in-operand, a)` | `Error(first-assignment-in-branch, a)` (section 5) |
| `Block(Assign(a, 0), Match(x, MatchCase(1, Assign(a, 2))), a)` | `Error(assignment-in-operand, a)` (CE-811) | valid; `2` when `x` is `1` |
| `f(Assign(a, 2))`, `[Assign(a, 1), 2]`, `Sum(Assign(s, s + i), (i, 1, 5))`, `If(Assign(c, True), 1, 2)` | `assignment-in-operand` | unchanged |

**One held operand (#437).** A `Mod` handler that computes
`Mod(Fibonacci(10^6), p)` in ℤ/p must see `Fibonacci(10^6)` before it is
evaluated. `lazy: true` holds every operand and loses the gates that a
non-lazy operator gets for free: about 30 sites in `boxed-function.ts` test
`def.lazy` (the NaN gate, the `requires`/`definedWhen` gate, signature
validation of a handler's result, the strict conformance check, the
unindexed-collection error, the unknown-length broadcast, the result caches,
and `simplify()` does not recurse into a lazy head). Measured at `2bf37102d`
with a lazy copy of `Mod` whose `canonical` handler canonicalizes every
operand and whose `evaluate` handler evaluates them and calls `Mod`'s
handler:

| Input | `Mod` (non-lazy) | lazy copy | Proposal: `Mod` with operand 0 `held` |
| --- | --- | --- | --- |
| `Mod(3*4, 5)` | `2`, type `integer` | `2`, type `real` | as non-lazy; the handler receives `12` unevaluated |
| `Mod('a', 3)` | `Error(incompatible-type)` | unevaluated, type `real` | as non-lazy |
| `Mod(1)` | `Error(missing)` | throws (`reading 'isInteger'`) | as non-lazy |
| `Mod([1, 2, 3], 2)` | `[1, 0, 1]`, `vector<integer^3>` | `[1, 0, 1]`, `vector<real^3>` | as non-lazy |
| `Mod(Range(1, n), 3)` | a lazy `Map` over the range | unevaluated | as non-lazy |
| `Mod(x·x − x² + 5, 3).simplify()` | `2` | unchanged | as non-lazy |
| `Mod(5, 0)` | `NaN`, type `nan` | `NaN`, type `real` | as non-lazy |

Why the engine cannot infer either: the only signals a definition carries are
`lazy`, `scoped`, the parameter types and the result type; none says which
operand the handler reads as written, or which it evaluates for its effect.
The operator must say it.

## 2. The statement position

A statement position has three properties, all settled at canonicalization:

1. **No `assignment-in-operand` error.** `withoutStatementOperands()` reads
   the operator's definition instead of the two closed lists, which are
   deleted. An operator with no definition has no statement positions.
2. **It is a branch.** The operand is canonicalized under `enterBranch()`
   (`assignment-locals.ts`), so a first assignment of a name that no scope
   declares is `first-assignment-in-branch`, and an assignment to a declared
   name (a block local, a parameter, a bound variable, an engine symbol)
   writes that name. A bare `Break` or `Continue` symbol is refused, as in an
   `If` branch. The engine cannot know whether the operator runs the operand
   zero, one or many times, so a first assignment there is never a
   declaration.
3. **Who canonicalizes it.** For an operator with no `canonical` handler, the
   framework canonicalizes each statement operand with `canonicalBranch()`
   inside `applyOperatorDefinition()`, after the binder scope and the binding
   sites exist (the binder hook wraps that function, `box.ts`). An operator
   with a `canonical` handler canonicalizes its statement operands itself, as
   `If`, `Which`, `Loop` and `Match` do today; property 1 still comes from the
   declaration. `canonicalBranch()` and `canonicalStatement()` move from
   `library/control-structures.ts` to a leaf module next to
   `assignment-locals.ts`, so that `box.ts` can call them.

A statement operand is never evaluated before the `evaluate` handler: the
handler runs it when and as often as it decides. `Block` keeps
`canonicalBlock()`, where a first assignment at the block's own level
declares a local: property 2 applies to a branch, and a `Block` statement is
not one. Nothing changes in the compiler: a host operator declines there
already, and the built-ins keep their lowering.

## 3. The operand-role handler

```ts
// OperatorDefinitionFlags
operands?: (ops: ReadonlyArray<Expression>) => ReadonlyArray<OperandRole>;

type OperandRole =
  | { kind: 'value' }      // canonical, validated, typed, EVALUATED before the handler (the default)
  | { kind: 'held' }       // canonical, validated, typed, NOT evaluated: the handler reads it as written (#437)
  | { kind: 'statement' }  // canonical as a branch (section 2), not evaluated (#513)
  | { kind: 'raw' }        // as written, not canonicalized (the default of a `lazy` operator)
  | { kind: 'opaque' }     // boxed raw and left non-canonical below (`Hold`, `Error`)
  | { kind: 'bound'; type?: TypeString }   // a bare symbol that is the operator's bound variable
  | { kind: 'clause'; type?: TypeString }; // an indexing set (`Limits`, `Element`, a tuple) whose index is bound
```

The handler returns one role per operand, in operand order (a variadic
operator sees the operands it was given). It runs once, at canonicalization,
on the raw operands, as the binding-site selectors run today, and the
normalized roles are kept on the boxed definition, not on the node: the
equality path does not change, and the evaluation path reads one array.

Two axes, one declaration. The **canonicalization axis** (consumed in
`applyOperatorDefinition()` and the binder hook around it, `box.ts`):
`raw` and `opaque` keep the operand as written; `statement` canonicalizes it
as a branch; `bound` and `clause` declare the variable in the operator's
scope before the other operands are canonicalized; `value` and `held`
canonicalize it as a value (in a lazy operator, a bare `N` or `D` there is a
variable, `devolveValueElements()`). The **evaluation axis** (consumed in
`holdMap()` and `holdMapAsync()`, `hold.ts`, which already skip an operand
wrapped in `Hold`): a `value` operand is evaluated before the handler; every
other role is handed to the handler as the canonicalization left it. The
`lazy` flag stays: it means that every operand defaults to `raw` and that the
gates above are skipped, as today. A non-lazy operator gets every gate, and
a `held` operand goes through them in its canonical form: an unevaluated
application never answers `isNaN`, a `definedWhen` on it reads that form, a
literal list in a held position is broadcast, and an operand that would only
evaluate to a list stays held (the unknown-length broadcast lifts it into a
`Map`, as `Mod(Range(1, n), 3)` is today). Under `evaluateAsync()` a handler
evaluates a held operand synchronously, as a lazy handler does today. `raw`
is valid only in a lazy operator (asserted at declaration, as
`evaluatesOperands` is).

What each role replaces:

| Role | Replaces | Today's declarations |
| --- | --- | --- |
| `bound` | `scoped: operandSites(i)`, `operandsFrom(i)` | `D`, `Series`, `Residue` and 3 more in `calculus.ts` |
| `clause` | `scoped: indexingSetSites(i, type)`, `limitsIndexSites(i)` | `Sum`, `Product`, `Integrate`, `Loop`, `Comprehension`, the 5 quantifiers, `NDSolveFunction` |
| `statement` | `STATEMENT_OPERATORS`, `isStatementPosition()` | `Block`, `Hold`, `Error`, `Typed`, `If`, `Which`, `Loop`, `MatchCase` |
| `value` (in a lazy operator) | `LAZY_VALUE_OPERAND_HEADS` (`box.ts`) | the 7 comparisons, `List`, `Set`, `If` and `Which` conditions |
| `opaque` | `PREBOX_OPAQUE_HEADS` (`box.ts`) | `Hold`, `Error`, `ErrorCode` |
| `held` | the "lazy, then rebuild the gates" recipe and the `evaluate` monkeypatch of #437 | none yet; `Mod` keeps its handler, the host declares its own |

16 library definitions carry a `scoped` selector today (counted with grep);
they become `operands` handlers, and the four selector helpers of
`binding-sites.ts` become the implementation that the `bound` and `clause`
roles call (`siteFor()`, `indexingSetSite()`), so the scope logic does not
move. `scoped: true` stays a boolean: a scope with no bound variable
(`Block`). The `scoped` selector form leaves the public type; a host that
passes one gets a thrown error naming `operands` (a breaking change,
CHANGELOG). The two sets that say which operands of a clause do not see its
index (`OWN_INDEX_OUTSIDE_BINDERS`, `FLAT_CLAUSE_BINDERS`) describe a part of
a clause, not an operand: they stay, or become a property of the `clause`
role if the implementation finds that natural. The evaluation-time flags
(`threadsConditionals`, `missingStrip`, `selectsOperands`,
`broadcastExemptions`, `evaluatesOperands`) describe values or the handler's
contract; they stay flags.

The reporters' operators under this form, none of them lazy:

- `Do(body, n)`: `operands: () => [{ kind: 'statement' }, { kind: 'value' }]`;
  `n` is validated against the signature and evaluated, the body is a branch.
  `While(c, body)`: `[held, statement]`, the handler evaluates `c` each turn.
- `Module({k}, body)`: `[{ kind: 'clause' }, { kind: 'statement' }]` binds `k`
  before the body is canonicalized, if the `clause` role reads a list of
  symbols; if it does not, `Module` declares its names in a `canonical`
  handler. To verify in the implementation: that an assignment to a bound
  variable of the operator's own scope counts as an assignment to a declared
  name (`isDeclaredForAssignment()`, `library/core.ts`).
- The host's `Mod`: `[{ kind: 'held' }, { kind: 'value' }]`, with the
  signature, `broadcastable` and `type` of the library `Mod`; the handler
  reads operand 0 as written for its fast path, else evaluates it and runs
  the usual computation. Every row of the second table gives the non-lazy
  column.

## 4. The commits

One task, three commits, each dual-reviewed (each changes a documented
contract):

1. The handler with the `statement`, `value`, `raw` and `opaque` roles; the
   three closed lists deleted; the eight statement operators and the eleven
   value heads migrated; the moved `canonicalBranch()`. Fixes #513 and
   CE-811.
2. The `held` role: `holdMap()` and `holdMapAsync()` skip a held operand;
   the `N()` route the same. Fixes #437.
3. The `bound` and `clause` roles; the 16 binder definitions migrated; the
   `scoped` selector form removed. The delicate commit (five wrong-scope
   defects came out of the binder code before the selectors existed,
   `binding-sites.ts` header), and a mechanical one: each selector maps to
   one role.

## 5. Not in this change

- **A sequence position for a host operator.** `Cell(Assign(a, 5))` at the
  top level is a branch under section 2, so an undeclared `a` is
  `first-assignment-in-branch`. A position that runs exactly once at the
  enclosing level (a `Block` statement, `Typed`) declares a local, and
  `canonicalBlock()` looks through it; giving that to a host operator means
  `canonicalBlock()` hoists through user operators by definition. It is a
  separate change if a `corpus` or `plausible` witness asks for it; the
  reporter boxes the cell's statement without the wrapper, or declares `a`.
- **The gates of a lazy operator.** A lazy operator keeps its opt-out of the
  gates; a host that wants them declares a non-lazy operator with `held`,
  `statement` or `raw`-free roles. `Hold` and `ReleaseHold` wrappers keep
  their meaning in `holdMap()`.
- **An asynchronous held operand.** `evaluatesOperands` stays the only way to
  have the asynchronous route evaluate operands for a handler.

## 6. Tests and documentation

- Tests: the rows of both tables of section 1, with a probe operator that
  records what its handler receives (`Fibonacci(…)` unevaluated at a `held`
  position, its value at a `value` position); a bare `Break` in a `Do` body
  is refused; the `Which`, `If`, `Loop` and `Match` forms of
  `test/compute-engine/compile-statement-forms.test.ts` and the block-locals
  tests unchanged; a host operator with a `canonical` handler that passes its
  body through unchanged still gets no error. Commit 3: the binder tests of
  `docs/SCOPING-MODEL.md` (the parse, `ce.box()` and `ce.function()` routes
  agree on the binding) unchanged, and one host binder declared with
  `operands`.
- `docs/ERROR-MODEL.md`, "Block locals": a statement position is "an operand
  that the operator's definition declares as a statement; a first assignment
  there is an error". `docs/SCOPING-MODEL.md`: the `operands` handler
  replaces the `scoped` selector in the text, and one paragraph on the order
  of consumption. `ARCHITECTURE.md`, the lazy-operator trap: the roles as the
  way to hold one operand. `src/api.md` through the doc comment of the field.
  CHANGELOG under `[Unreleased]`, with the breaking change of commit 3.
  cortexjs.io: `06-guide-augmenting.md` (the handler, with the `Do`, `Mod`
  and binder examples), `85-reference-core.md` if it lists the statement
  operators.
- Size: L (`box.ts`, `boxed-function.ts`, `hold.ts`, `binding-sites.ts`,
  `boxed-operator-definition.ts`, `types-definitions.ts`, 16 binder
  definitions, 8 statement operators, the moved helpers, tests, docs).

## 7. Open for the user

Revision 3 is the form the user chose, with the `held` role added. Approval
of this revision starts commit 1. Two points are marked "to verify in the
implementation" in section 3; neither changes the design.
