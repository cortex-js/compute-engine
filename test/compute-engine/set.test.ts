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
    expect(ce.expr(['Element']).evaluate()).toMatchInlineSnapshot(
      `["Element", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(ce.expr(['Element', 2]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, ["Error", "'missing'"]]`
    );
    expect(ce.expr(['Element', 2, 'Integers', 'Numbers']).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Element",
        2,
        "Integers",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'boolean'",
            "set<finite_integer>"
          ]
        ]
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
