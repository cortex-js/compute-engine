# CE-1518: derive the signatures of a cycle of recursive functions as one group

Status: the board must approve this plan and answer the questions of
section 8 (`issues/CE-1518.md`, `needs-design`). Measured on 2026-11-25 at
`9d0541fa0e292220fe760fa0244b0a717aa754b5`.

## 1. The question

A function whose signature has `unknown` slots (declared `function` or
`(unknown) -> unknown`) gets its signature derived from its body when the
signature is read. When the function calls itself through other such
functions, the derivations nest: the read of one head types its body, which
reads the next head, which types its body, and so on around the cycle. The
engine finds the cycle only when a derivation reads the provisional
signature of a head whose derivation is still running
(`noteReentrantSignatureRead`), and then marks every derivation in between
as tainted: none is memoized, and the next read derives it again.

This plan finds the cycle before any derivation runs. The cycle is a
strongly connected component of the static call graph. The signatures of
its members are derived together, by an explicit fixpoint iteration, and
stored together. No derivation inside the group reads a provisional answer
that the group does not own, so nothing is tainted and nothing is derived
again.

## 2. What the code does today

Probes in the session scratchpad, rebuilt from the witnesses of CE-1515 and
CE-1516 (`a_2`, `b_2`, `c_2` with an integer base case, steps
`c_2(n−1) + b_2(n−1)`, `c_2(n−1) + n²`, `a_2(n−1)`, and
`d_2(x) = a_2(3) + x²`):

| Program                                                          | Result on main                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| heads declared `function`, first read `b_2(m).type`              | 13.1 s, `number`; then 0 ms for `a_2` and `c_2`                                    |
| heads declared `function`, first read `a_2(m).type`              | 2 ms, `number`                                                                    |
| heads declared `(unknown) -> unknown`, assignments               | 688 ms                                                                            |
| heads declared `(unknown) -> unknown`, first read `b_2(m).type`  | `any`; `a_2(m)` and `c_2(m)` are `number`                                         |
| list variant of CE-1516 (base `[1]`, steps of `Join`), `(unknown) -> unknown` | `d_2(m)` is `collection<unknown>`                                     |
| the same list variant, heads declared `function`                 | `d_2(m)` is `list<integer>`                                                       |
| CE-1091 pair, `g` assigned before `f`, any read order            | `g(m)` is `number`, but `g(1)` is `"a"` (wrong type; documented known limitation) |
| `F := n ↦ If(n = 0, x > 0, G(n − 1))`, `G := n ↦ F(n)`, `function` | `F(m)` is `unknown` (documented loss of precision)                                |

So the time of a read, and the type it gives, depend on which head is read
first and on how the heads are declared. The last two rows are in
`docs/TYPE-SYSTEM.md`: the paragraph "This rule is simple and sound, and it
loses precision in a mutual recursion…" and the known limitation of CE-1091.

The mechanisms involved, all in `src/compute-engine/boxed-expression/`:

- `_deriveSignature` and `_deriveSignatureOnce`, once in
  `boxed-value-definition.ts` (a value definition that holds a function
  literal, including the bare `function` case through
  `_wildcardRecursiveSignature`) and once in `boxed-operator-definition.ts`
  (an operator definition with a lambda literal). A derivation types the
  literal (`v.type`), types the body under the declared parameter types
  (`resultUnderDeclaredParameters`), runs `verifiedListHypothesis`, and
  refines the skeleton. It checks its memo (`_signatureMemo`) only after
  `v.type`, because the memo is keyed on the content of that type.
- A re-entrant read of the head being derived answers the recorded
  signature, or the candidate in `_recursionResult`
  (`_derivingSignature`).
- `noteReentrantSignatureRead` (`declared-parameter-result.ts`) taints the
  derivations between the read and the owner.
- The frame memo of CE-1516 (`signatureDerivedInFrame`,
  `keepSignatureInFrame`) reuses a signature derived in the same pass of the
  parent derivation. It has a known limit: a kept signature can have read a
  stack-dependent answer that changes later in the same pass.
- `verifiedListHypothesis` already runs a fixpoint over the members of a
  cycle (`cycleMembers`, `provisionalResults`, `memberCandidates`), but only
  to verify a list hypothesis for one function, and inside the derivation of
  that function.
- `unknownCallMayBeRecursive` leaves a call out of the join of a
  conditional when the callee is in computation; this is what makes the base
  case the first approximation of a recursive result.
- The type cache (`cache.ts`) keeps a type computed from a stack-dependent
  answer under the fallback generation, which only the `any` axis moves.
  That is the cause of CE-1091: a body type computed while another function
  was being typed survives that computation.

## 3. Design

### 3.1 Members and the component

A **member** is a definition whose signature is derived from its literal:
a value definition with a signature skeleton or a recursive literal under a
bare `function` declaration, or an operator definition with a skeleton and
a lambda literal. A definition with a full declared signature is not a
member: its signature is a contract, and a call of it reads the contract,
so it cuts every cycle that passes through it. A function whose signature
is inferred at assignment (no declaration) is not a member either.

The **call graph** has an edge from member `A` to member `B` when the
literal of `A` holds, anywhere (in a nested function literal too), a call
whose head resolves to `B`, with the resolution of `calleeLiteral` (the
definition the head holds now, also for a call boxed as a forward
reference). The graph is static: it reads the literals, never a type.

The **component** of a member is its strongly connected component in that
graph (Tarjan, over the members reachable from it). The component is cached
on the member with the key that `_wildcardSkeleton` uses
(`declaredResultMemoKey`): a new definition or assignment moves it.

An edge that the graph misses (a function passed as a value and applied
by a parameter: `F(n) = G(F, n)` with `G := (h, n) ↦ h(n − 1)`) leaves the
cycle split. The reads along that edge keep the present path: a re-entrant
read, a taint, no memo. That is correct and possibly slow, as today. An
edge that the graph adds without a real call (a call in a branch that never
runs) makes the component larger, which costs work, not correctness.

### 3.2 The group derivation

A read of the signature of a member whose component has two members or
more, when no memo answers it, runs the derivation of the whole component:

1. Order the members by name, so that the result does not depend on
   which head was read first.
2. Give each member a candidate result, `unknown` at the start: a call of a
   member in computation that is typed `unknown` is left out of a join
   (`unknownCallMayBeRecursive`), so the first round gives the base cases.
3. A round derives each member in order, with every member in computation:
   `_derivingSignature` set on each, and its candidate in
   `_recursionResult` and in `provisionalResults`. A read of the signature
   of any member answers its recorded signature with the candidate as its
   result, and it starts no derivation. The result of a member is the type
   of a fresh boxing of its body under the declared parameter types
   (`resultUnderDeclaredParameters` with `rebox`), not the cached type of
   its literal: the cached type may come from an earlier computation
   (CE-1091). The candidate becomes the new result as soon as it is
   computed (Gauss–Seidel order).
4. Repeat until a round changes no candidate. The candidates are then a
   fixpoint: each member's body, with the calls of the members typed by the
   candidates, is a subtype of the member's candidate.
5. A candidate that is an abstract collection is replaced, once, by the
   list hypothesis that `verifiedListHypothesis` uses today
   (`listHypothesisOf`, with the proposal seed of `emptyElementSeedOf`).
   The iteration continues; the fixpoint check of step 4 accepts or refutes
   the hypothesis, as the verification does today.
6. When the fixpoint is not reached within `MAX_GROUP_ROUNDS` rounds, every
   member's result is the result of its skeleton (`unknown`). That is wider
   than any derived result, so it is sound.
7. Store the signature of every member, built from its candidate as
   `refineDeclaredPlaceholders` builds it today, in its `_signatureMemo`, in
   one step at the end.

The cost is the number of rounds times the members times one boxing of
each body. For the witness of section 2 that is an estimated 3 rounds of 3
bodies; the main-tree read of `b_2(m)` runs thousands of derivations
(the counts in `issues/CE-1518.md`: 12 of `c_2`, 3,264 of `b_2` and
12,288 of `a_2`).

### 3.3 Reads during a group

- A read of a member answers its candidate (3.2, step 3). It calls
  `noteStackDependentAnswer()`, as a re-entrant read does today, so no type
  computed in a round is kept after the group.
- It does not taint the group: the group owns the answer. A derivation of a
  non-member nested in a round cannot read a member through a static edge,
  since such a function would be in the component. When it reads one
  through a value (3.1), the taint applies as today.
- A non-member callee is derived by its own path. When its own component
  has two members or more, that component is derived as a group nested in
  the round, and stored, since it reads nothing of the outer group.

### 3.4 The memo

The memo of a group member is checked before the type of its literal is
read. That is the change that ends the rework: today each signature read
types the literal first, the literal's type reads the other members, and
each of them types its own literal. The memo key is the state that the
derivation depends on, without the content of the literal's type:

- the recorded type, the skeleton and the literal of every member;
- `declaredResultMemoKey` and `_definitionsKey()` (the engine versions and
  whether the assumptions are hidden);
- the definitions of the free symbols of each body in the scope of the read
  (`_freeSymbolDefinitions`);
- the declaration counts of the callee homes (`calleeHomesDeclarationCount`).

Whether these cover every change that the content key covers today is the
main risk of the plan (section 7). Step 3 runs the suite with a shadow check
that computes the literal's type after each memo hit and compares the
signature.

Nothing is stored while `_resultMayBeDiscarded()` is true, as today.

### 3.5 Why the result is sound

Let `R` be the candidates when the iteration stops, and `f_i(R)` the type
of the body of member `i` with the calls of the members typed by `R`. The
iteration stops when `f_i(R) <: R_i` for every `i`. Take a call that
terminates, and argue by induction on the depth of its recursion: a call
that reaches no member returns a value of `f_i(·)` whatever the candidates
are, and a call whose nested calls of members return values of their
candidates returns a value of `f_i(R)`, so of `R_i`. This is the argument
that `verifiedListHypothesis` makes today for one function, extended to the
members of the cycle. The fallback of step 6 is the skeleton, which holds
every value.

### 3.6 What stays as it is

- A component of one member (a function that calls only itself) keeps the
  present path: `_derivingSignature`, the hypothesis of the earlier
  derivation, `verifiedListHypothesis`. Those cases are fast today, and
  their tests pin results (CE-1501, CE-447, `census-head-new-declines`)
  that this plan does not need to touch. Question Q1 asks whether to bring
  them into the group path in a later task.
- The parameter types of a signature still come from the literal's type
  (`refineDeclaredPlaceholders`), read once after the group, when every
  member's memo answers.
- Effects: `_wildcardRecursiveSignature` and `_reviseLiteralArrowEffects`
  read the effects of the literal after the derivation, as today. With the
  memos stored, those reads do not derive again.

## 4. What it removes or changes

- The nested derivations of cycle members, and their taints, for every
  cycle the graph sees.
- The frame memo of CE-1516 (`signatureDerivedInFrame`,
  `keepSignatureInFrame`, the `phase` and `derived` fields of a frame): its
  only use is a nested derivation of a cycle member. It is removed in
  step 5 if the measurements show no regression (Q3). Its known limit goes
  with it.
- For group members, `verifiedListHypothesis` and its `memberCandidates`
  are replaced by the group's own candidates (3.2, step 5).
- CE-1091 and the loss of precision of section 2 are expected to be fixed
  (the body is boxed afresh in a round, and both functions are derived
  together). If the acceptance tests confirm it, the two paragraphs of
  `docs/TYPE-SYSTEM.md` are rewritten to state the group rule (Q4).

## 5. Steps

1. **Instrumentation and witnesses.** A counter of derivations, of tainted
   derivations and of body boxings per read (test-only, like
   `failClosedCounts`). The acceptance programs of section 6 as tests that
   assert the types, the values and a bound on the derivation count, not a
   time. The tests that main fails stay skipped until the step that fixes
   them.
2. **The component.** `signatureComponent(member)`, with its cache and
   unit tests: a cycle of three, a pair with self-calls, a forward
   reference, a call in a nested function literal, a member with a full
   declared signature that cuts the cycle, a function passed as a value
   (not an edge).
3. **The group derivation**, for components of two members or more, in a
   new module next to `declared-parameter-result.ts`. Both definition
   classes expose one round of their derivation to it through a small
   interface (the literal, the skeleton, the recorded type, and a method
   that types the body under a candidate table), instead of duplicating the
   loop. The memo is checked before the literal's type. The shadow check of
   3.4 runs on the full suite once, and is then removed.
4. **The list hypothesis in the group** (3.2, step 5). The test "a list base
   clause derives a list" (`recursive-function-result-type.test.ts`) and the
   CE-479 tests (`ce-479-recursive-map-result-type.test.ts`) must pass
   unchanged.
5. **Removal of the frame memo**, measured: the witnesses of CE-1516 and
   this plan, a cycle of six heads, and the timing tests of the signature
   suites, before and after.
6. **Documents.** `docs/TYPE-SYSTEM.md` (the rule for a cycle of calls, and
   the two paragraphs of section 4), a `CHANGELOG.md` item, and the
   closing of CE-1518 and CE-1516.

Each step is one commit with its tests. Size L.

## 6. Acceptance tests

- The witness of section 2 with `function` and with
  `(unknown) -> unknown`, read in each of the six orders of the three heads:
  each head is `number`, `d_2(1)` is 8, and the count of derivations of the
  first read is bounded (`MAX_GROUP_ROUNDS × 3`).
- The same with a direct self-call in `b_2` (`d_2(1)` is 11), and the pair
  `h_0`, `h_1` of `ce-582-recursive-type-facts-hidden.test.ts`.
- The list variant of CE-1516, with both declarations: `d_2(m)` is
  `list<integer>`, and `d_2(2)` is `[3, 1, 2, 1, 4]`.
- The CE-1091 pair in the four orders of assignment and read: `f(m)` and
  `g(m)` hold `"a"` and `2` (expected: `integer | string` for both).
- `F := n ↦ If(n = 0, x > 0, G(n − 1))`, `G := n ↦ F(n)`: `F(m)` is
  `boolean` (expected).
- Unchanged: `recursive-function-result-type.test.ts`,
  `ce-479-recursive-map-result-type.test.ts`,
  `ce-582-recursive-type-facts-hidden.test.ts`,
  `census-head-new-declines.test.ts`, `scope-advanced.test.ts` (mutual
  recursion), `definition-order.test.ts`, and the Tycho test
  `tests/node/graph-paper/scalar-parameter-signature.test.ts`.

## 7. Risks

- **The memo key (3.4).** Today's content key on the literal's type also
  catches changes that move no version. If the shadow check finds one, the
  key gets the missing version, or, when none exists, the group memo falls
  back to today's check after the literal's type for that member. The plan
  then still removes the nested derivations, but less of the cost of a
  first read.
- **Convergence.** A body whose result type grows at each round (a list
  nested one level deeper each time) reaches the round limit and gets the
  skeleton's `unknown`. That is sound, but less precise than the present
  hypothesis path for a single function, which is why one-member
  components stay on that path (3.6).
- **Cost of a round.** A fresh boxing of each body per round. For a large
  component (dozens of members, Tycho's signature-analysis scope), the
  rounds times the members may cost more than today's first read of the
  head that happens to be fast. Step 5 measures a cycle of six heads;
  `MAX_GROUP_ROUNDS` bounds the rest.
- **Read order.** The canonical order of 3.2 makes the result the same
  whichever head is read first. A test that pins a type that today depends
  on the order can change; such a change is reported, not hidden.

## 8. Questions for the board

- **Q1. Components of one member.** (a) Leave them on the present path
  (recommended: they are fast and pinned by tests). (b) Bring them into the
  group path too, which would remove `_recursionResult`, the hypothesis of
  the earlier derivation and `verifiedListHypothesis`, as a later task
  after this one.
- **Q2. The round limit.** (a) `MAX_GROUP_ROUNDS = 8`, with the skeleton as
  the fallback (recommended: the witnesses need an estimated 2 to 4 rounds;
  step 1 measures them). (b) A limit that grows with the size of the
  component.
- **Q3. The frame memo of CE-1516.** (a) Remove it in step 5 if the
  measurements show no regression (recommended: its only use is gone, and
  so is its stale-answer limit). (b) Keep it for the edges that the graph
  misses.
- **Q4. `docs/TYPE-SYSTEM.md`.** (a) If the CE-1091 and precision tests
  pass, replace the known limitation and the precision paragraph by the
  group rule (recommended). (b) Keep the paragraphs and only add the rule.
