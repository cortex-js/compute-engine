# Simplification Invariants

This document records internal simplification contracts that are easy to break
when changing canonicalization, evaluation, or rewrite rules. User-facing
examples and API guidance belong in
[`doc/11-guide-simplify.md`](../doc/11-guide-simplify.md); unfinished feature
work belongs in [`ROADMAP.md`](../ROADMAP.md).

## Canonicalization is not simplification

Canonicalization runs when expressions are boxed or parsed. It normalizes
structure and folds exact numeric operands before any `.simplify()` call.
Examples include:

- `Add(2, x, 5)` → `Add(x, 7)`
- `Add(1/3, x, 2/3)` → `Add(x, 1)`
- `Multiply(2, x, 5)` → `Multiply(10, x)`
- `Multiply(1/2, x, 2)` → `x`

The generic-symbol folds `x/x → 1`, `1^x → 1`, `x/0`, `0/x`, and `x/∞` also
belong to canonicalization. Their conventions are documented in
[`ARCHITECTURE.md`](../ARCHITECTURE.md#generic-symbol-conventions-at-canonicalization).

## `simplify()` and the `Simplify` operator

The `.simplify()` method and the `Simplify` operator deliberately have
different contracts.

### The method is rule-based and value-blind

`expr.simplify()` applies simplification rules and folds purely numeric
subexpressions. It does not invoke an operator's `evaluate` handler and does not
substitute assigned symbol values.

Consequently, a head whose result comes only from an evaluation handler — such
as `Determinant`, `Trace`, `Length`, `D`, or `Integrate` — can remain unchanged
under the method when no simplification rule covers it.

For an evaluate-then-simplify operation, use:

```ts
expr.evaluate().simplify();
```

### The operator evaluates before applying rules

`Simplify(expr)` evaluates its argument and then simplifies the result. It runs
operator handlers and observes assigned values. It is the operator-surface
counterpart of `expr.evaluate().simplify()`.

`N()` also runs handlers, but requests a numeric approximation rather than an
exact result.

### Assigned values do not influence the method

During `.simplify()`, assigned non-constant symbols are treated as valueless
while retaining their declared types. Sign and parity information therefore
comes from types and assumptions, not from the current assigned value.

For example, with `w := 5`, `abs(w).simplify()` remains `abs(w)` and
`sqrt(w^2).simplify()` is `abs(w)`. The result remains valid if `w` is later
assigned `-3`. An assumption such as `assume(w > 0)` may license the stronger
rewrite because an assumption is part of the symbolic context.

Constants such as π retain their values because their value is part of their
identity.

On the operator surface, `HoldValues(body)` provides the value-blind route. It
shields all assigned free symbols, or a selected subset, for the duration of
evaluation while preserving declared types and assumptions.

## Generic-real simplification policy

This is the authoritative policy for real-only rewrites over an unknown symbol.

An unconstrained numeric symbol is treated as a generic real unless declared
otherwise. Identities that are valid over the reals may therefore apply even
when they differ on the complex plane or at a measure-zero exceptional point.

For an unconstrained `x`:

| Simplification | Result | Rule class |
| --- | --- | --- |
| `ln(x) + ln(y)` | `ln(xy)` | Generic-real |
| `ln(x^3)` | `3 ln(x)` | Generic-real; differs at negative reals |
| `ln(x^2)` | `2 ln(abs(x))` | Always sound over the reals |
| `sqrt(x^2)` | `abs(x)` | Always sound over the reals |

Even powers use the absolute-value form. Odd and irrational exponents use the
optimistic generic-real convention.

### When a real-only rewrite must decline

A real-only rewrite is skipped when the operand's declared type admits
genuinely non-real values: its type matches `complex` or `imaginary`, but not
`real`. The shared gate is `isEligibleRealRewrite` in
`src/compute-engine/function-properties/index.ts`.

- An unconstrained symbol is eligible.
- A symbol declared `complex` or `imaginary` is not eligible.
- A symbol known positive through assumptions may use a stronger form without
  an absolute value.
- Declared real subtypes, such as `integer`, use the real-safe absolute-value
  form unless assumptions prove a sign.

Branch-cut-sensitive logarithm combinations additionally consult the branch-cut
guard and remain symbolic when an operand is provably on the negative-real
cut.

## Recursion and ordering constraints

- Do not call `.simplify()` from inside a simplification rule or from a helper
  invoked by a rule. Re-entering the rule engine can recurse indefinitely.
- Evaluation is not a subset of simplification, and simplification is not a
  subset of evaluation. Choose the operation that matches the intended
  contract.
- A transformation that needs assigned values belongs on an evaluation path,
  not in the value-blind method.
- Domain-sensitive rewrites must be gated by declared types and assumptions;
  they must not inspect an assigned value as evidence.
- Completed regression campaigns belong in tests and Git history rather than
  in this specification.
