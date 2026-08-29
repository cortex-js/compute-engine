# Standard-library signature guidelines

Status: **Draft 1** (2026-08-27), written as a follow-up to the
numeric-lattice ratification
(`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`). The
rules below implement Contract B (`docs/ERROR-MODEL.md` §4) at the level
of individual definitions. They are guidelines with a case-by-case escape
valve: a definition may deviate, but the deviation is stated in a comment
at the definition.

Type spellings in this document use the ratified finite-by-default
lattice (`docs/TYPE_SYSTEM_ROADMAP.md` §8): bare `real`/`integer`/… mean
finite; `infinity` and `nan` are types; `real | infinity` is the extended
real line.

## 1. Who reads a signature

A declared signature serves two audiences with different needs, and the
tension between them is what these guidelines resolve:

- **Machines** — the compiler (lane selection, guard erasure), the
  simplification and antiderivative rule engines (domain preconditions),
  and the assumptions system. They want the sharpest sound claim.
- **People** — documentation, editor hovers, and error messages quote
  the declared signature verbatim. They want something readable.

The resolution: **the declared signature is written for people; the
per-call sharpness is computed for machines.** A type handler (and, as
the type language grows, a refinement clause) may derive a sharper type
at a call site than the declaration states; a literal-carrying type is
handler-visible and widened before it is stored (ruling O9). So
precision lost in the declaration is not lost to the machine consumers —
it is recovered where it is cheap and hidden where it is noise.

## 2. Result types: precision versus readability

1. **Use the narrowest NAMED numeric type, then refine with a range.**
   `-> rational<0..1>` is right for a function whose values are
   0, ½, and 1. The range carries the bounds the compiler and the
   assumptions system consume; the named tier keeps it readable.
2. **Unions in a DECLARED result: at most two arms**, and each arm a
   named type or a single literal. `real | infinity` (a quotient that
   can blow up) and `integer | +oo` (an extent that can be unbounded)
   are good declared unions. Three or more literal arms are not:
   spell `0 | 1/2 | 1` as `rational<0..1>` and let the handler answer
   the exact literal when the argument is a literal.
3. **A handler-computed type may be as sharp as it likes** — literal
   unions included — because the widening boundary protects the stored
   contract. Sharpness belongs at the call site, not in the API surface.
4. **Do not claim what machine evaluation cannot keep.** A bare `real`
   result is a finiteness promise about the mathematical value; the
   float image may saturate to an infinity (`MAX_VALUE + MAX_VALUE` is
   `Infinity`). This is the documented, ruled escape (ruling L6, option
   (a)): the declared type describes the mathematical value, and the
   numeric route may saturate. Do not widen every result with
   `| infinity` to chase it.

Worked example — `Heaviside`. Candidates: `-> number` (information-free),
`-> rational` (no bounds), `-> 0 | 1/2 | 1` (three literal arms — rule 2
rejects it), `-> rational<0..1>` (**chosen**: named tier, bounds carried,
one token wide). At a literal argument the type handler still answers the
exact value's type.

## 3. Parameter types: how lenient, and no silent coercion

1. **The parameter type is the mathematical domain** (Contract B's
   carrier), not an admission net. Do not widen a parameter to `number`
   to "tolerate" NaN — tolerance is the `nanBehavior` policy's job, and
   bare `number` in a signature is a smell (it smuggles the exceptional
   points into the domain).
2. **Never coerce silently.** `IsPrime(3.5)` does not round. No
   standard-library operator invents a nearby in-domain value for an
   out-of-domain argument.
3. **Membership predicates take the wide numeric carrier and `handle`.**
   A membership question is well-defined for every number — the answer
   for a non-member is `False`, not an error. So
   `IsPrime: (number) -> boolean` with `nanBehavior: 'handle'`:
   `IsPrime(7) → True`, `IsPrime(3.5) → False`, `IsPrime(π) → False`,
   `IsPrime(NaN) → False`. A narrow `(integer)` carrier would turn
   "no, 3.5 is not prime" into a type error — a category mistake. (A
   spelling like `range<1,oo>` is doubly wrong: it bakes the answer's
   support into the question's domain.)

   *Where a carrier exclusion goes*: `IsPrime` and `IsComposite` accept all
   of `number` except the infinities — primality is a question about finite
   integers. They still DECLARE `(number) -> boolean` and enforce the
   exclusion in the handler, which answers the same `incompatible-type`
   error at evaluation. Writing the narrower carrier into the signature
   (`(complex | nan)`) was tried and reverted: a declared parameter type is
   also what an undeclared argument symbol is inferred FROM, so `IsPrime(n)`
   declared the caller's own `n` as `complex | nan` — this predicate's
   private exclusion stamped onto a name the rest of the program uses. Read
   the rule as: put in the signature what a CALLER should be held to; put
   in the handler what only the implementation knows. `NaN` needs no arm of
   its own here — it rides in on `number` and the handler answers `False`,
   which is the job `nanBehavior: 'handle'` will name once that machinery
   exists. Two related decisions the predicate makes in the same place:
   `IsPrime(-7)` is `False` — a prime is a positive integer greater than 1
   (SymPy's convention, ruled 2026-08-29) — and `IsComposite` is NOT
   `Not(IsPrime(n))`, since `0`, `1` and every non-integer are neither
   prime nor composite.
4. **Domain-restricted functions answer in the wider codomain, not with
   an error.** `Sqrt(-2)` is a complex number; `Arcsin(2)` is complex.
   The declared result widens (`-> complex`, or a union per rule §2.2);
   the argument is not rejected.
5. **Administrative slots reject.** An index, a digit count, a
   dimension: `integer`-family carrier, `nanBehavior: 'reject'` (the
   mechanical default for integer slots), violation → `Error`. An
   integer slot that is a *mathematical operand* (`GCD`) overrides to
   `propagate` explicitly.
6. **Genuinely-infinite arguments are out of domain for finite-domain
   operators, and the signature now says so** (ruling L9):
   `GCD: (integer+) -> integer` rejects `GCD(oo, 2)` at validation.
   An operator whose mathematics extends to the infinities declares it:
   `Limit`'s point is `real | infinity`.

## 4. When things happen: boxing versus evaluation

The timing contract, stated once (operators individually note only
their deviations):

- **At boxing/canonicalization**: structure and arity are checked, and
  every violation PROVABLE FROM TYPES is surfaced — an operand whose
  type is disjoint from the parameter's carrier becomes an
  `Error(incompatible-type)` wrapped in place (`Sin("banana")`). A
  literal `NaN` in a `reject` slot is provable and errors here. A
  literal `NaN` in a `propagate` slot is admitted — propagation is
  evaluation behavior, not a boxing error.
- **At `evaluate()`**: value-dependent outcomes happen — a
  `definedWhen` failure produces the codomain's marker (`Mod(1, 0)` →
  `NaN`); a `propagate` slot receiving `NaN` makes the application
  `NaN`; a `handle` operator's handler answers in its own codomain;
  exact results stay exact or symbolic (the exactness contract).
- **At `.N()`**: numeric-route failures appear — non-representability
  produces the marker (`Sin(10000i).N()` → `NaN`), and float overflow
  may saturate to an infinity (ruling L6(a)).
- **Deviations that exist today** and are tracked, not blessed: `lazy`
  operators validate later than boxing (their operands arrive unbound);
  operators with `canonical` handlers currently bypass declared-
  signature validation (the §4.4 runtime-conformance work). A
  definition relying on either timing states it in a comment.

The general principle: **boxing errors are for what the types already
prove; evaluation is for what only values decide.** Nothing should wait
for evaluation to report a statically-provable type error, and nothing
should error at boxing on a value the declaration says to propagate or
handle.

## 5. Quick reference

| Situation | Spelling | Timing |
| --- | --- | --- |
| Result with known bounds | narrowest named tier + range (`rational<0..1>`) | — |
| Result that can blow up | `real \| infinity` (≤2 arms) | — |
| ≥3 literal result values | a range, not a literal union | — |
| Membership predicate | `(number) -> boolean`, `handle` | non-member → `False` at evaluate; a carrier exclusion goes in the HANDLER (§3.3) |
| Domain-restricted function | precise carrier, wider codomain | `Sqrt(-2)` → complex, no error |
| Index/count/dimension slot | `integer`-family, `reject` | violation → `Error` at boxing when provable |
| Mathematical integer slot | `integer`, explicit `propagate` | `NaN` flows at evaluate |
| Infinite argument, finite-domain op | rejected by the carrier (L9) | `Error` at boxing when provable |
| Float overflow of a finite claim | documented saturation (L6(a)) | `.N()` only |
