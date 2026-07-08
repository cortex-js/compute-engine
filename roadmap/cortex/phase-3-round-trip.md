# Phase 3 — Round-Trip Coherence

_Make `serializeCortex` and `parseCortex` inverses over the MathJSON that
matters, and lock it with a property test. Lighter than Phases 1–2; mostly
serializer work. Depends on Phase 2._

## Work items

1. **Property test harness** (`test/cortex/round-trip.test.ts`):
   `parse(serialize(expr))` structurally equals `expr` (modulo documented
   normalizations: number formatting, `Negate` of literals folding to
   negative `num`). Corpus: hand-picked expressions per operator/collection
   form, plus a sweep over existing MathJSON fixtures from the engine test
   suite (reuse, don't invent). Failures must name the construct, not just
   dump trees.
2. **Serializer gaps** (currently fall through to generic `Fn(args)` form):
   - `Dictionary` (the `dictionaryFromExpression` path exists; align it
     with the Phase 2 `{k -> v}` grammar and unquoted-key rules).
   - `Do` (statement-per-line; the program wrapper — renamed `Block` in
     Phase 4), `If` (Phase 4 decides the full statement
     form; until then serialize as conditional expression).
   - `Rational` (`["Rational", 1, 2]` → `1/2`), negative-literal forms.
   - Invisible multiply: serialize `["Multiply", 2, "x"]` as `2x` per the
     Phase 2 grammar decision (digit-followed-by-symbol only); the two
     `test.skip`s in `cortex-serialize.test.ts` become real tests (mixed
     numbers / invisible plus stay **out** — delete that skip with a note).
   - `Tuple` → `(a, b)`.
3. **Formatter pass**: `formatter.ts` (539 lines) survives as-is through
   Phases 1–2; give it a review here — line-wrapping of long collections
   and interpolated strings, `fancySymbols` spacing — plus unit tests for
   wrap behavior at small margins (it currently has none of its own).
4. **Comment round-trip decision** (language-review §2.9): v0 scope call —
   either parse-side attachment of comments to the next expression's
   MathJSON metadata, or explicitly documented lossy behavior. (Leaning:
   lossy in v0; notebooks keep prose in markdown cells, not code comments.)
5. **Loose-syntax compatibility spot-check** (decision record item (ii)):
   table of overlap constructs (`**`, `|>`, `[1,2,3]`, `f(x,y)`, bare
   function names, `2x`) × {Cortex parse, `ce.parse(strict:false)`} —
   assert same MathJSON or document the divergence in `docs/syntax.md`.

## Definition of done

- Round-trip property test green over the corpus.
- No expression in the corpus serializes to something that re-parses with
  diagnostics.
- Serializer emits every construct the Phase 2 grammar can parse.
