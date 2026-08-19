# Parse-scope containment follow-ups

**Date:** 2026-08-04
**Status:** ACTIVE — structural/partial-form fixes, per-call scopes,
`InspectableScope`, trigger-spelled call heads, and the corpus round-trip lane
are implemented; two containment/verification follow-ups remain.

The implemented parse and binding contract is normative in
`docs/SCOPING-MODEL.md` and `docs/LANGUAGE-MODEL.md`. Git history contains the
original staged design, Tycho rulings, and implementation notes.

## 1. Outer-scope inference containment

Supplying `{ scope }` contains declarations created by parse/box, but inference
may still narrow a pre-existing definition found through the scope's parent
chain. `InspectableScope.narrowings()` reports those writes today; it does not
prevent them.

Decide and implement one explicit policy:

- `scope` contains both declarations and inference by default; or
- add an option that suppresses inference writes outside the supplied scope.

Requirements:

- lookups may still use parent definitions;
- a suppressed write must not perturb provenance, invalidation axes, or later
  inference in the ambient engine;
- the supplied scope's own definitions infer normally;
- box, expression, strict/loose LaTeX, and structural/partial routes agree;
- `narrowings()` either becomes the preview of suppressed writes or is clearly
  documented as observation-only.

Use the existing inference rollback/journal primitive from
`docs/TYPE-SYSTEM.md`; do not add a second inference transaction mechanism.

## 2. Seeded generator lane

The versioned MathNet corpus and exception list cover the regular
serialize→parse property in CI. Add the complementary nightly lane:

1. generate canonical trees from a seeded, reproducible generator;
2. serialize to LaTeX and parse in a fresh engine;
3. compare with the structural `Same` tier;
4. minimize and promote a failure to the regular corpus before changing an
   exception;
5. report seed and generator version on failure.

The generator must respect operator arity and documented serializer-loss
classes; random invalid MathJSON is a parser fuzz test, not this property.

## Exit criteria

- The outer-scope policy is ruled, documented, and route-parity tested.
- The seeded lane is deterministic and runs in the nightly budget.
- `docs/SCOPING-MODEL.md`, public parse options, and MathNet instructions are
  current.

Then remove this plan.
