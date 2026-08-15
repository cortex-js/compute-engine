import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

describe('ELEMENT', () => {
  test(`literal`, () => {
    expect(ce.expr(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'Numbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'Booleans']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "Booleans"]`
    );
  });

  test('List', () => {
    expect(
      ce.expr(['Element', 3, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Element', 5, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('Sublists', () => {
    expect(
      ce.expr(['Element', ['List', 2, 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Element', ['List', 3, 2], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Element', ['List', 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('INVALID', () => {
    // Rung 3 of the error-propagation design: the validation error bubbles
    // out of the frozen `Element(…Error…)` tree, carrying the breadcrumb of
    // the operand position it came from.
    expect(ce.expr(['Element']).evaluate()).toMatchInlineSnapshot(
      `["Error", "'missing'", ["ErrorTrace", ["ErrorFrame", "'Element'", 1]]]`
    );
    expect(ce.expr(['Element', 2]).evaluate()).toMatchInlineSnapshot(
      `["Error", "'missing'", ["ErrorTrace", ["ErrorFrame", "'Element'", 2]]]`
    );
    expect(ce.expr(['Element', 2, 'Integers', 'Numbers']).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Error",
        [
          "ErrorCode",
          "incompatible-type",
          "'boolean'",
          "set<finite_integer>"
        ],
        ["ErrorTrace", ["ErrorFrame", "'Element'", 3]]
      ]
    `);
    expect(ce.expr(['Element', 2, 3]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, 3]`
    );
  });

  // Type-style membership checks
  // Element supports checking if a value belongs to a type, not just a set
  test('Type-style membership with mathematical sets', () => {
    // Mathematical sets with type names work
    expect(ce.expr(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'RealNumbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'ComplexNumbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Non-integer in Integers
    expect(ce.expr(['Element', 2.5, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `False`
    );
  });

  test('Type-style membership with type names', () => {
    // Type names like 'integer', 'real', 'number' work
    expect(ce.expr(['Element', 2, 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'real']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'number']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Refined types like 'finite_real'
    expect(ce.expr(['Element', 2, 'finite_real']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 2, 'finite_integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Non-integer values
    expect(ce.expr(['Element', 2.5, 'integer']).evaluate()).toMatchInlineSnapshot(
      `False`
    );
  });

  test('Type-style membership with invalid type names', () => {
    // Invalid type names (like 'Booleans') remain unevaluated
    expect(ce.expr(['Element', 2, 'Booleans']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "Booleans"]`
    );

    // Misspelled or non-existent types remain unevaluated
    expect(ce.expr(['Element', 2, 'IntegerZ']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "IntegerZ"]`
    );
  });

  test('Type-style membership with symbolic values', () => {
    // When the value is symbolic, Element checks the declared type
    ce.declare('x', 'integer');
    expect(ce.expr(['Element', 'x', 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.expr(['Element', 'x', 'real']).evaluate()).toMatchInlineSnapshot(
      `True` // integer is a subtype of real
    );
    expect(ce.expr(['Element', 'x', 'string']).evaluate()).toMatchInlineSnapshot(
      `False` // integer is not a string
    );

    ce.forget('x');
  });

  test('Type-style membership distinguishes sets from primitive types', () => {
    // Mathematical sets (have collection definitions)
    expect(ce.expr(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Type names (mathematical types)
    expect(ce.expr(['Element', 2, 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Primitive types that aren't mathematical (these remain unevaluated)
    expect(ce.expr(['Element', 2, 'boolean']).evaluate()).toMatchInlineSnapshot(
      `False` // 2 is not a boolean
    );
    expect(ce.expr(['Element', 2, 'string']).evaluate()).toMatchInlineSnapshot(
      `False` // 2 is not a string
    );
  });

  // Regression for G3: membership of an indeterminate-type value in a number
  // set must stay unevaluated (three-valued logic), not collapse to `False`.
  test('Element of a symbol of indeterminate type stays unevaluated', () => {
    ce.declare('g3a', 'unknown');
    // Indeterminate: g3a could be a real / integer, so neither True nor False.
    expect(ce.expr(['Element', 'g3a', 'RealNumbers']).evaluate().json).toEqual([
      'Element',
      'g3a',
      'RealNumbers',
    ]);
    expect(ce.expr(['Element', 'g3a', 'Integers']).evaluate().json).toEqual([
      'Element',
      'g3a',
      'Integers',
    ]);
    ce.forget('g3a');
  });

  test('Element of concrete values remains decidable', () => {
    // Concrete number literals keep an exact (definitive) membership answer.
    expect(ce.expr(['Element', 3, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(
      ce.expr(['Element', 2.5, 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Element', -5, 'NegativeNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Element', 5, 'NegativeNumbers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    // Disjoint type → definitive False even though the value is symbolic.
    ce.declare('g3s', 'string');
    expect(
      ce.expr(['Element', 'g3s', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    ce.forget('g3s');
  });
});

describe('SUBSET', () => {
  // Regression for G12: the subset dispatcher tested the relation backwards,
  // so primitive-set chains were inverted.
  test('strict subset of primitive number sets', () => {
    expect(
      ce.expr(['Subset', 'Integers', 'RationalNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', 'RationalNumbers', 'RealNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', 'RealNumbers', 'ComplexNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // The reverse direction is False, and a set is not a *strict* subset of
    // itself.
    expect(
      ce.expr(['Subset', 'RationalNumbers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Subset', 'Integers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('SubsetEqual allows equality', () => {
    expect(
      ce.expr(['SubsetEqual', 'Integers', 'RationalNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['SubsetEqual', 'Integers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('Superset is the reverse of Subset', () => {
    expect(
      ce.expr(['Superset', 'RationalNumbers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('the empty set is a subset of every set', () => {
    expect(
      ce.expr(['Subset', 'EmptySet', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', 'Integers', 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['SubsetEqual', 'EmptySet', 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', 'EmptySet', 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  // The `subsetOf` collection handler had TWO contradictory readings of its
  // operand order: the `Set` handler answered `receiver ⊆ other` (the public
  // `Expression.subsetOf()` contract) while the named number sets answered
  // `other ⊆ receiver`, and the dispatcher assumed the second. Against a `Set`
  // literal that computed the question backwards, so both directions were
  // wrong at once.
  test('set literals answer in the right direction', () => {
    expect(
      ce.expr(['Subset', ['Set', 1], ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', ['Set', 1, 2], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['SubsetEqual', ['Set', 1], ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['SubsetEqual', ['Set', 1, 2], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Superset', ['Set', 1, 2], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // A set is a subset (possibly equal) of itself, but not a strict one.
    expect(
      ce.expr(['SubsetEqual', ['Set', 1], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', ['Set', 1], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  // `SupersetEqual`/`NotSupersetEqual` passed `strict = true`, so the
  // "possibly equal" reading denied that a set is a superset of itself.
  test('SupersetEqual allows equality', () => {
    expect(
      ce.expr(['SupersetEqual', ['Set', 1], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['SupersetEqual', 'Integers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['NotSupersetEqual', ['Set', 1], ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['NotSupersetEqual', ['Set', 1], ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('a finite collection is a subset of the number set it fits in', () => {
    expect(
      ce.expr(['SubsetEqual', ['Set', 1, 2], 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['SubsetEqual', 'Integers', ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['SubsetEqual', ['Range', 1, 10], 'PositiveIntegers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // A `Range` that straddles zero is not a subset of the positive integers
    // (`Range`'s `eltsgn` used to report any ASCENDING range as `positive`).
    expect(
      ce.expr(['SubsetEqual', ['Range', -5, 10], 'PositiveIntegers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['SubsetEqual', ['Range', -5, 10], 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // Decided from the element type alone, so the size of the range is
    // irrelevant — no walk happens.
    expect(
      ce.expr(['SubsetEqual', ['Range', 1, 1000000], 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('sign constraints compose along the lattice', () => {
    expect(
      ce.expr(['Subset', 'PositiveIntegers', 'NonNegativeNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', 'NonNegativeIntegers', 'PositiveIntegers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Subset', 'ImaginaryNumbers', 'ComplexNumbers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  // The signed INTEGER sets are declared over `integer`, which admits the
  // infinities, while `Integers` is declared over `finite_integer`, which does
  // not — and their `contains` handlers agree: `NegativeIntegers` contains
  // -oo, `Integers` does not contain +oo. So the negative integers are NOT a
  // subset of `Integers`; `ExtendedIntegers` is the one that contains them.
  // The answer looks wrong at a glance, which is why it is pinned here.
  test('the signed integer sets admit the infinities', () => {
    expect(
      ce.expr(['Subset', 'NegativeIntegers', 'Integers']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Subset', 'NegativeIntegers', 'ExtendedIntegers']).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // The `contains` handlers this rests on:
    expect(
      ce.box('NegativeIntegers').contains(ce.box({ num: '-Infinity' }))
    ).toBe(true);
    expect(ce.box('Integers').contains(ce.box({ num: '+Infinity' }))).toBe(
      false
    );
  });

  // An empty interval is a subset of every collection, including one that is
  // not an interval — the generic path cannot decide that case, because it
  // declines anything not known finite and an `Interval` never reports finite.
  test('an empty Interval is a subset of a non-Interval collection', () => {
    expect(
      ce.expr(['Subset', ['Interval', 5, 3], ['Set', 1, 2, 3]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce
        .expr(['Subset', ['Interval', ['Open', 5], ['Open', 5]], 'Integers'])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  // Two ranges can share a step and still be disjoint if their grids are out
  // of phase: {2, 4} is not a subset of {1, 3, 5}.
  test('Range subset requires matching bounds AND phase', () => {
    expect(
      ce.expr(['Subset', ['Range', 2, 4, 2], ['Range', 1, 5, 2]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['Subset', ['Range', 2, 4, 2], ['Range', 2, 6, 2]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce
        .expr(['SubsetEqual', ['Range', 2, 6, 2], ['Range', 2, 6, 2]])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', ['Range', 2, 6, 2], ['Range', 2, 6, 2]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  // A range stops at the last grid point at or before its upper BOUND, so two
  // ranges with different bounds — or different steps — can be the same set.
  test('Range subset compares elements, not declared bounds', () => {
    // Both enumerate {1, 4}.
    expect(
      ce
        .expr(['SubsetEqual', ['Range', 1, 5, 3], ['Range', 1, 4, 3]])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Subset', ['Range', 1, 5, 3], ['Range', 1, 4, 3]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    // Both are {1}: with a single element there is no second point for the
    // step to place, so the steps need not divide one another.
    expect(
      ce
        .expr(['SubsetEqual', ['Range', 1, 1, 1], ['Range', 1, 1, 5]])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
    // A descending range takes the elementwise walk; {10, 7, 4, 1} ⊆ {1..10}.
    expect(
      ce
        .expr(['SubsetEqual', ['Range', 10, 1, -3], ['Range', 1, 10]])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  // Strictness asks whether the SUPERSET has an element the subset lacks.
  // Comparing sizes instead is wrong in both directions for a collection whose
  // elements repeat, and `List` admits duplicates where `Set` does not.
  test('strictness over a collection with duplicate elements', () => {
    // Same elements, different sizes — not a strict subset.
    expect(
      ce.expr(['Subset', ['List', 1, 1], ['List', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.expr(['SubsetEqual', ['List', 1, 1], ['List', 1]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    // Same size, different elements — a strict subset.
    expect(
      ce.expr(['Subset', ['List', 1, 1], ['List', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  // `Interval`'s emptiness is decided by its endpoints, not by its endpoint
  // MARKERS: a doubly-open reversed interval used to report itself non-empty,
  // and the degenerate closed `[1, 1]` used to report itself empty while its
  // own `contains(1)` answered `True`.
  test('Interval emptiness follows the endpoints', () => {
    expect(
      ce.expr(['Interval', ['Open', 2], ['Open', 1]]).isEmptyCollection
    ).toBe(true);
    expect(ce.expr(['Interval', 2, 1]).isEmptyCollection).toBe(true);
    expect(ce.expr(['Interval', 1, 1]).isEmptyCollection).toBe(false);
    expect(ce.expr(['Interval', 1, 1]).contains(ce.box(1))).toBe(true);
    expect(
      ce.expr(['Interval', ['Open', 1], ['Open', 1]]).isEmptyCollection
    ).toBe(true);
    expect(ce.expr(['Interval', 1, 2]).isEmptyCollection).toBe(false);
    // An empty interval is a subset of every interval.
    expect(
      ce
        .expr([
          'SubsetEqual',
          ['Interval', ['Open', 2], ['Open', 1]],
          ['Interval', ['Open', 0], ['Open', 0.5]],
        ])
        .evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  // A symbol DECLARED with a set type but not yet assigned is not a decided
  // `False`: answering one would flip to `True` on assignment.
  test('an unresolved operand leaves the relation unevaluated', () => {
    const engine = new ComputeEngine();
    engine.declare('unassignedSet', 'set<number>');
    expect(
      engine.expr(['SubsetEqual', 'EmptySet', 'unassignedSet']).evaluate().json
    ).toEqual(['SubsetEqual', 'EmptySet', 'unassignedSet']);
    expect(
      engine.expr(['SubsetEqual', ['Set', 1], 'unassignedSet']).evaluate().json
    ).toEqual(['SubsetEqual', ['Set', 1], 'unassignedSet']);
    // Same for a collection-typed APPLICATION, whose collection type may be a
    // vacuous-lift artifact rather than a promise: it never claims a size, so
    // the strictness test must not read "not known finite" as "infinite".
    engine.declare('vectorValued', '(number) -> vector<2>');
    expect(
      engine.expr(['Subset', ['Set', 1], ['vectorValued', 1]]).evaluate().json
    ).toEqual(['Subset', ['Set', 1], ['vectorValued', 1]]);
    // A value whose type rules out a collection is still a decided `False`.
    expect(
      engine.expr(['Subset', 3, ['Set', 1]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });
});

describe('UPPER HALF-PLANE (\\mathbb{C}^+)', () => {
  test('parses and canonicalizes membership to Im(z) > 0', () => {
    // `z \in \mathbb{C}^+` is input shorthand for the part predicate Im(z) > 0;
    // the membership is canonicalized away (no standalone UpperHalfPlane set).
    expect(ce.parse('z \\in \\mathbb{C}^+').json).toEqual([
      'Less',
      0,
      ['Imaginary', 'z'],
    ]);
    // Braced superscript parses identically
    expect(ce.parse('z \\in \\mathbb{C}^{+}').json).toEqual([
      'Less',
      0,
      ['Imaginary', 'z'],
    ]);
  });

  test('literal membership evaluates (open upper half-plane)', () => {
    expect(
      ce.parse('\\imaginaryI \\in \\mathbb{C}^+').evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.expr(['Element', ['Negate', 'ImaginaryUnit'], 'UpperHalfPlane']).evaluate()
    ).toMatchInlineSnapshot(`False`);
    // The real axis (Im = 0) is excluded from the OPEN upper half-plane
    expect(
      ce.expr(['Element', 2, 'UpperHalfPlane']).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('the symbol serializes back to \\mathbb{C}^+', () => {
    expect(ce.expr('UpperHalfPlane').latex).toMatchInlineSnapshot(`\\mathbb{C}^+`);
  });
});

describe('FINITE SET OPERATIONS (value tables)', () => {
  // Regression for: Intersection(Set(1,2), Set(2)) incorrectly evaluated to
  // EmptySet. The bug: the implementation checked `isFiniteIndexedCollection`
  // on the other operands, but a `Set` is finite and NOT indexed, so it fell
  // into the "treat operand as a single scalar value" branch and compared
  // each candidate element to the whole `Set` expression (never matching).
  test('Intersection', () => {
    expect(
      ce.expr(['Intersection', ['Set', 1, 2], ['Set', 2]]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 2]`);
    expect(
      ce.expr(['Intersection', ['Set', 1, 2], ['Set', 2, 3]]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 2]`);
    expect(
      ce
        .expr(['Intersection', ['Set', 1, 2], ['Set', 1, 2], ['Set', 2, 3]])
        .evaluate()
    ).toMatchInlineSnapshot(`["Set", 2]`);
    // No overlap -> EmptySet
    expect(
      ce.expr(['Intersection', ['Set', 1, 2], ['Set', 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
    // Empty-set edge
    expect(
      ce.expr(['Intersection', ['Set', 1, 2], 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
  });

  test('Union', () => {
    expect(
      ce.expr(['Union', ['Set', 1, 2], ['Set', 2, 3]]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1, 2, 3]`);
    expect(
      ce.expr(['Union', ['Set', 1, 2], 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1, 2]`);
    expect(
      ce.expr(['Union', 'EmptySet', 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
  });

  test('SetMinus', () => {
    expect(
      ce.expr(['SetMinus', ['Set', 1, 2], ['Set', 2]]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1]`);
    expect(
      ce.expr(['SetMinus', ['Set', 1, 2], 2]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1]`);
    // Removing everything -> EmptySet
    expect(
      ce.expr(['SetMinus', ['Set', 1, 2], ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
    expect(
      ce.expr(['SetMinus', 'EmptySet', ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
  });

  // Regression: SymmetricDifference had no `evaluate` handler at all, so it
  // never reduced finite literal-set operands to a `Set` result.
  test('SymmetricDifference', () => {
    expect(
      ce.expr(['SymmetricDifference', ['Set', 1, 2], ['Set', 2, 3]]).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1, 3]`);
    expect(
      ce.expr(['SymmetricDifference', ['Set', 1, 2], 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`["Set", 1, 2]`);
    // Identical sets -> EmptySet
    expect(
      ce.expr(['SymmetricDifference', ['Set', 1, 2], ['Set', 1, 2]]).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
    expect(
      ce.expr(['SymmetricDifference', 'EmptySet', 'EmptySet']).evaluate()
    ).toMatchInlineSnapshot(`EmptySet`);
  });
});

describe('AMBIGUOUS BRACKET PAIRS: interval at the LaTeX boundary only', () => {
  // `[a, b]` / `(a, b)` are read as intervals when they are direct operands
  // of a set operator IN LATEX (`parsedIntervalOperand`,
  // latex-syntax/dictionary/definitions-sets.ts). A directly-constructed
  // MathJSON `List`/`Tuple` is a two-element collection, never an interval.

  test('LaTeX: membership in a closed/open interval', () => {
    expect(ce.parse('x \\in \\lbrack 1, 5 \\rbrack').json).toEqual([
      'Element',
      'x',
      ['Interval', 1, 5],
    ]);
    expect(ce.parse('x \\in (1, 5)').json).toEqual([
      'Element',
      'x',
      ['Interval', ['Open', 1], ['Open', 5]],
    ]);
    expect(ce.parse('1.5 \\in \\lbrack 1, 5 \\rbrack').evaluate().json).toEqual(
      'True'
    );
  });

  test('LaTeX: union/intersection of bracket-pair intervals', () => {
    expect(
      ce.parse('\\lbrack 1,2 \\rbrack \\cup \\lbrack 3,4 \\rbrack').json
    ).toEqual(['Union', ['Interval', 1, 2], ['Interval', 3, 4]]);
    expect(ce.parse('(-\\infty, 0) \\cup (0, \\infty)').json).toEqual([
      'Union',
      ['Interval', ['Open', 'NegativeInfinity'], ['Open', 0]],
      ['Interval', ['Open', 0], ['Open', 'PositiveInfinity']],
    ]);
  });

  test('LaTeX: set difference reads bracket pairs as intervals', () => {
    // Regression: `\setminus` previously kept the raw Tuple/List (the
    // engine-side coercion never covered it).
    expect(ce.parse('\\R \\setminus (0,1)').json).toEqual([
      'SetMinus',
      'RealNumbers',
      ['Interval', ['Open', 0], ['Open', 1]],
    ]);
  });

  test('LaTeX: reversed membership and subset relations', () => {
    expect(ce.parse('\\lbrack 1,5 \\rbrack \\ni x').json).toEqual([
      'Element',
      'x',
      ['Interval', 1, 5],
    ]);
    expect(
      ce.parse('\\lbrack 1,2 \\rbrack \\subset \\lbrack 0,5 \\rbrack').json
    ).toEqual(['Subset', ['Interval', 1, 2], ['Interval', 0, 5]]);
  });

  test('MathJSON: a 2-element List is a collection, not an interval', () => {
    // The trap this fixes: `Intersection([1,2], [2,3])` used to intersect
    // INTERVALS ([1,2] ∩ [2,3] = {2} only by accident of the endpoints;
    // Union([1,2],[3,4]) returned an interval union, not {1,2,3,4}).
    expect(
      ce.expr(['Intersection', ['List', 1, 2], ['List', 2, 3]]).evaluate().json
    ).toEqual(['Set', 2]);
    expect(
      ce.expr(['Union', ['List', 1, 2], ['List', 3, 4]]).evaluate().json
    ).toEqual(['Set', 1, 2, 3, 4]);
    // Membership is collection membership: 1.5 is not an element of {1, 5}
    expect(ce.expr(['Element', 1.5, ['List', 1, 5]]).evaluate().json).toEqual(
      'False'
    );
    expect(ce.expr(['Element', 1, ['List', 1, 5]]).evaluate().json).toEqual(
      'True'
    );
  });
});

describe('ELEMENT — tuple/list of symbols distributes over membership', () => {
  test('(a, b) ∈ ℤ distributes to a conjunction of memberships', () => {
    const r = ce.expr(['Element', ['Tuple', 'a', 'b'], 'Integers']).evaluate();
    // No longer the surprising `False`; the universal idiom "a, b ∈ ℤ".
    expect(
      r.isSame(
        ce.box(['And', ['Element', 'a', 'Integers'], ['Element', 'b', 'Integers']])
      )
    ).toBe(true);
  });

  test('(a, b) ∈ ℝ distributes as well', () => {
    const r = ce.expr(['Element', ['Tuple', 'a', 'b'], 'RealNumbers']).evaluate();
    expect(
      r.isSame(
        ce.box([
          'And',
          ['Element', 'a', 'RealNumbers'],
          ['Element', 'b', 'RealNumbers'],
        ])
      )
    ).toBe(true);
  });

  test('a tuple of VALUES is not distributed (product-set membership)', () => {
    // (1, 2) is not a scalar integer, so membership stays a plain (false) test.
    expect(ce.expr(['Element', ['Tuple', 1, 2], 'Integers']).evaluate().symbol).toBe('False');
  });

  test('scalar membership is unchanged', () => {
    expect(ce.expr(['Element', 3, 'Integers']).evaluate().symbol).toBe('True');
  });
});
