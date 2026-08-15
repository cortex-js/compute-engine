> **STATUS 2026-08-15: all 14 findings applied to the spec.** Finding 2
> was resolved by a user ruling (introduce a real `range` type = index
> span); findings 1, 3–14 were applied directly. Finding 3's tuple
> defect was also filed as a live bug in `ROADMAP.md`. Applying the
> `range` ruling forced a correction to the Phase 0 mechanism — see
> "Signature refinement" in the spec.

# Spec review round 2: docs/STRING_ROADMAP.md (2026-08-14)

Dual-reviewer pass (Claude + Codex, high reasoning) on the revised spec —
after the round-1 findings, Phase 0, `Join`/`StringJoin`, the
sequence-search family, `Slice(xs, range)`, and the collation section were
added. Round-1 archive: `STRING_ROADMAP_SPEC_REVIEW.md`.

14 findings — 1 critical, 4 high, 7 medium, 2 low · 0 flagged by both
(the two reviewers' sets are fully disjoint this round) · 1 live code
defect discovered during verification (filed in `ROADMAP.md`). Code-level
claims in findings 2, 3, and 6 were verified empirically before inclusion.

## Findings

1. **[CRITICAL] [Codex] [consistency] `RangeOf` — the defining law is
   false across sibling kinds.** The signature admits any
   `indexed_collection<T>` needle, so for `xs = "ab"`, `needle =
   Characters("ab")` (a `list<character>`): `RangeOf` returns `1..2`, but
   `Slice(xs, 1..2)` is the STRING `"ab"` (Slice is kind-preserving after
   Phase 0/1) while the needle is a `list<character>` — disjoint siblings
   by constraint 2, never `==`. The law `Slice(xs, RangeOf(xs, needle))
   == needle` is unsatisfiable as stated. Fix: state the law
   element-wise ("has the same element sequence as the needle") or
   restrict it to a same-kind needle, and add mixed-kind acceptance
   tests.

2. **[HIGH] [Claude] [feasibility] `range` is not a type in the type
   system — and the damage extends beyond `RangeOf`'s signature.**
   Verified: `PRIMITIVE_TYPES` has no `range`/`linspace`; `Range(1,10)`
   types as `indexed_collection<integer>`; the type parser hard-errors on
   unknown identifiers, so the literal signature `-> range | nothing`
   does not parse. Amplified consequence (verified): every Phase 0 claim
   of the form "`Take(1..10, 3)` types as `range`" is wrong — with no
   `range` static type, `T` binds to `indexed_collection<integer>` for a
   range argument, so the tightening is a static WIDENING for ranges
   (from `list<integer>`) and a narrowing only for string/list. Decide:
   introduce real `range`/`linspace` types (new, non-trivial scope — the
   spec must say so), or rewrite `RangeOf`'s signature as
   `-> indexed_collection<integer> | nothing` and correct Phase 0's
   static-type claims to runtime-kind claims.

3. **[HIGH] [Codex] [architecture-fit] Tuples are indexed collections and
   break the `(T) -> T` bounds — with a LIVE defect as evidence.**
   Verified: `tuple` matches `indexed_collection`, and shipped `Reverse`
   already lies — `Reverse((1, "a"))` statically claims
   `tuple<finite_integer, string>` for the value `("a", 1)` (filed in
   `ROADMAP.md`). `Rest`/`Most`/`Take`/`Drop`/`Slice` on tuples change
   arity and field meaning, so the Phase 0 bounds must not admit tuples.
   Decide the mechanism (a tuple carve-out on the bound, or per-kind
   overloads) and fold the existing `Reverse` defect into the same fix.

4. **[HIGH] [Codex] [edge-case] Sequence search has no
   finite/enumerability policy.** `RangeOf` over an infinite subject
   (`1..oo`) with an absent needle cannot terminate; `EndsWith` cannot
   inspect an infinite or unknown-length subject; non-enumerable indexed
   values exist. Specify per operator: finiteness requirements, and the
   result for infinite / unknown-length / non-enumerable subjects and
   needles (the house pattern is "stay symbolic", as `StringJoin` and
   `Sort` already do on non-finite input).

5. **[HIGH] [Codex] [completeness] `NumberFrom` has no parse contract.**
   Accepted grammar (signs, decimals, exponents, bases, infinities,
   Unicode digits?), exactness (does `"0.1"` produce an exact decimal or
   a float? — interacts with the evaluate/N exactness contract), and the
   failure result are all unstated. Define grammar, result
   representation, and the error value, with tests.

6. **[MEDIUM] [Claude] [completeness] `Sort`'s arity split is a bigger
   change than the classification admits — and supersedes a documented
   pin.** Verified: `Sort` today is ONE signature with an optional
   `order`, and its evaluate carries a deliberate comment: results
   rebuild as `List`, "never the source's head (a `Range`/`Linspace`
   head would reinterpret the sorted elements as lo/hi/step)". The spec
   must state the mechanism — split into a two-arm overload (unary
   `(T) -> T`; comparator arm with `order` REQUIRED, `-> list<T>`) — and
   explicitly supersede the List-rebuild pin for the unary arm
   (reconstruction as a proper `Range` call, not head-swapping).

7. **[MEDIUM] [Codex] [completeness] The compile-target matrix omits the
   `character` scalar itself.** `CharacterFrom`, narrowed literals,
   `String(c)`, character equality/ordering, and `list<character>`
   values need per-target rows (faithful lowering or a capability
   diagnostic) — the Python type-gate for string *collection* operations
   doesn't answer whether `CharacterFrom("a")` compiles.

8. **[MEDIUM] [Codex] [consistency] "Free … with no string-specific
   code" contradicts the Phase-1 string-runtime requirement.** The
   kind-preserving members of that list (`Reverse`, `Take`, `Drop`,
   `Slice`, `Rest`, `Most`, unary `Sort`, `Unique`) DO require
   string-specific segment→operate→join runtimes in Phase 1. Stale
   wording from an earlier draft; reword and split the list by actual
   Phase-1 result behavior.

9. **[MEDIUM] [Codex] [edge-case] Residual unspecified edges in Phase 2
   operations.** `PadStart`/`PadEnd`: default pad (space?), empty-string
   pad (error — "fit exactly" is impossible), non-string pad.
   `StringJoin(xs, sep?)`: empty collection (→ `""`?), non-finite
   collection (stays symbolic, as today). `StringReplace`: empty
   replacement = deletion (say so), and whether the scan walks the
   ORIGINAL segmentation or the evolving result (the existing
   "replacement content is never re-matched" implies original-plus-skip —
   state it as the rule).

10. **[MEDIUM] [Claude] [consistency] Collation table calls sequence
    search "codepoint-literal" — the doc's own semantics are
    character-literal.** A codepoint-literal search WOULD match `x`
    inside `x́`, which the worked examples rule out. Change to
    "character-literal".

11. **[MEDIUM] [Claude] [consistency] "Following the
    `StartsWith`/`EndsWith` precedent" is circular.** Those operators
    don't exist yet — they're proposed three paragraphs later in the
    same section. Drop the "precedent" framing; the design stands on the
    stated reasoning.

12. **[MEDIUM] [Claude] [edge-case] `StartsWith`/`EndsWith` empty
    prefix/suffix unspecified.** The siblings each got a deliberate
    empty-needle rule; these didn't. State it: empty prefix/suffix →
    `True`, matching `ContainsSequence`, not `RangeOf`.

13. **[LOW] [Claude] [completeness] `Join`'s string-preserving overload
    needs its trigger condition.** `Join("ab", ["c","d"])` — all-string
    operands only (list falls back to list-out), or any
    character-elemented operands? One sentence.

14. **[LOW] [Codex] [consistency] A worked example uses the rejected
    `++` operator.** `RangeOf("e" ++ combining-acute ++ "e", "e")` is
    not valid Epsil under the doc's own concatenation ruling. Respell
    with an escape-bearing literal or `String(…)`.

## Suggested revisions (by theme)

- **Theme A — the `range` type question (biggest decision):** finding 2;
  touches `RangeOf`'s signature, Phase 0's static claims, and the
  breaking-change description.
- **Theme B — tuples vs the bounds:** finding 3 (+ the filed `Reverse`
  defect).
- **Theme C — sequence-search semantics:** findings 1, 4, 12, 14.
- **Theme D — Phase 2 operation contracts:** findings 5, 6, 9, 13.
- **Theme E — wording/terminology consistency:** findings 8, 10, 11.
- **Standalone:** finding 7 (target matrix).
