# Phase 0 — Hygiene

_Make the existing (pre-rewrite) code and docs honest. Every item is
mechanical; none depends on the new parser. Can run in parallel with
Phase 1._

## Code fixes

1. **`#date` pragma** — `src/cortex/parse-cortex.ts:113`: `today.getDay()`
   (day-of-week) → `getDate()` (day-of-month). Add a parse test that checks
   the format shape, not the value.
2. **List/Set delimiters** — `src/cortex/serialize-cortex.ts` `FUNCTIONS`
   table: `List` serializes with `{…}` and `Set` with `[…]`; swap to match
   `docs/cortex.md` (list = `[…]`, set = `{…}`, empty set = `{}` — but see
   [`language-review.md`](./language-review.md) §1.5 for the `{}`
   disambiguation this implies). Update the affected
   `cortex-serialize.test.ts` inline snapshots by hand (they are few) —
   don't `-u` blindly.
3. **Operator-name mismatch** — serializer `OPERATORS` keys
   `ElementOf`/`NotElementOf` → `Element`/`NotElement` (MathJSON standard;
   what the parser emits). Add a serialize test for
   `["Element", "x", "S"]` → `x in S`.
4. **`#warning`/`#error` console output** — `parse-cortex.ts:167,173`: drop
   the `console.log`/`console.error`; `#warning` should append a
   warning-severity `ParsingDiagnostic`, `#error` already throws
   `FatalParsingError` (keep that, minus the console write).

These land on the current `point-free-parser`-based implementation and all
survive the Phase 1 rewrite (they live in the serializer and the pragma
mapping, which are ported, not rewritten).

## Docs fixes (Part 1 "pure error" items of the language review)

5. `docs/cortex.md`: fix the four readmore links; replace the dated
   `Domain(x)` example.
6. `docs/implementation.md`: fix malformed JSON examples, "Dicitionary",
   and the `+=` → `["Equal", …]` example (use plain `x = x + 1` →
   `["Assign", …]` until compound assignment is designed).
7. `docs/literals.md`: fix the two wrong glyphs in the prohibited-character
   table; sync the reserved-word list with `reserved-words.ts` (add
   `async`, `generator`, `iterator`, `parallel`, `union`, `variant`) and
   add a unit test asserting docs/code agreement (regex-extract the docs
   list) so it can't drift again.
8. `docs/pragmas.md`: keep the implemented family
   (`#url`/`#filename`/`#line`/`#column`), remove `#sourceFile`/`#sourceUrl`,
   mark `#sourceLocation()` as future.
9. `docs/operators.md`: remove the word-form logic operators (`and`, `or`,
   `not`, `=>`, `<=>`) or mark them explicitly reserved-not-implemented;
   note `=` is assignment. (Full rewrite of this page happens in Phase 2
   with the shared operator table.)
10. `docs/principles.md`: remove the dangling bullet.
11. `parse-cortex.ts:32`: delete the stale `fixed-point-parser` comment
    (moot once Phase 1 deletes the file, but trivial).

## Definition of done

- `npm run test cortex/cortex-parse` and `cortex/cortex-serialize` green;
  changed snapshots limited to the List/Set and Element items and reviewed
  individually.
- `npm run typecheck` clean.
- No behavior change outside `src/cortex/`.
