---
name: add-operator
description: Add or substantially extend a Compute Engine mathematical operator, covering evaluation, result types, parsing, compilation, and regression tests.
---

# Add or extend an operator

Read the relevant [architecture contracts](../../../ARCHITECTURE.md) and
[operator review checks](../../../docs/REVIEW-CHECKLIST.md). Use an existing
operator with similar behavior as the implementation model.

- Locate the definition and related tests with `scripts/where.ts`. Change the
  signature, algebraic flags, and handlers together as needed. Exact evaluation
  and numerical approximation must honor the documented exactness contract.
- Give the operator an accurate result type, including possible non-finite
  results. Follow the architecture's non-finite typing convention.
- Update LaTeX parsing/serialization when applicable. Lazy operators need box
  and parse route tests. Binding operators use the framework's scoped selectors.
- For collection parameters, confirm runtime shape and element checks cover
  cases that static overlap checking accepts provisionally. Test conforming
  values and relevant invalid shapes/elements, with an explicit refusal
  behavior.
- Check supported compilation targets for parity or an explicit refusal. Choose
  focused regressions for the behavior being changed, including non-finite cases
  when applicable; do not automatically run every compiler or test suite.
- Update the relevant user reference and changelog. Documentation locations and
  code conventions are in [CODING-STYLEGUIDE.md](../../../CODING-STYLEGUIDE.md).

Use [BUILD.md](../../../BUILD.md#completing-delegated-tasks) to agree on
validation ownership and report any remaining checks. The skill is a task aid;
it does not duplicate the repository's completion or shared-machine rules.
