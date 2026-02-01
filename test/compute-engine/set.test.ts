import { engine as ce } from '../utils';

describe('ELEMENT', () => {
  test(`literal`, () => {
    expect(ce.box(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'Numbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'Booleans']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "Booleans"]`
    );
  });

  test('List', () => {
    expect(
      ce.box(['Element', 3, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.box(['Element', 5, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('Sublists', () => {
    expect(
      ce.box(['Element', ['List', 2, 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.box(['Element', ['List', 3, 2], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.box(['Element', ['List', 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('INVALID', () => {
    expect(ce.box(['Element']).evaluate()).toMatchInlineSnapshot(
      `["Element", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(ce.box(['Element', 2]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, ["Error", "'missing'"]]`
    );
    expect(ce.box(['Element', 2, 'Integers', 'Numbers']).evaluate())
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
    expect(ce.box(['Element', 2, 3]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, 3]`
    );
  });

  // Type-style membership checks
  // Element supports checking if a value belongs to a type, not just a set
  test('Type-style membership with mathematical sets', () => {
    // Mathematical sets with type names work
    expect(ce.box(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'RealNumbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'ComplexNumbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Non-integer in Integers
    expect(ce.box(['Element', 2.5, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `False`
    );
  });

  test('Type-style membership with type names', () => {
    // Type names like 'integer', 'real', 'number' work
    expect(ce.box(['Element', 2, 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'real']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'number']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Refined types like 'finite_real'
    expect(ce.box(['Element', 2, 'finite_real']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'finite_integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Non-integer values
    expect(ce.box(['Element', 2.5, 'integer']).evaluate()).toMatchInlineSnapshot(
      `False`
    );
  });

  test('Type-style membership with invalid type names', () => {
    // Invalid type names (like 'Booleans') remain unevaluated
    expect(ce.box(['Element', 2, 'Booleans']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "Booleans"]`
    );

    // Misspelled or non-existent types remain unevaluated
    expect(ce.box(['Element', 2, 'IntegerZ']).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, "IntegerZ"]`
    );
  });

  test('Type-style membership with symbolic values', () => {
    // When the value is symbolic, Element checks the declared type
    ce.declare('x', 'integer');
    expect(ce.box(['Element', 'x', 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 'x', 'real']).evaluate()).toMatchInlineSnapshot(
      `True` // integer is a subtype of real
    );
    expect(ce.box(['Element', 'x', 'string']).evaluate()).toMatchInlineSnapshot(
      `False` // integer is not a string
    );

    ce.forget('x');
  });

  test('Type-style membership distinguishes sets from primitive types', () => {
    // Mathematical sets (have collection definitions)
    expect(ce.box(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Type names (mathematical types)
    expect(ce.box(['Element', 2, 'integer']).evaluate()).toMatchInlineSnapshot(
      `True`
    );

    // Primitive types that aren't mathematical (these remain unevaluated)
    expect(ce.box(['Element', 2, 'boolean']).evaluate()).toMatchInlineSnapshot(
      `False` // 2 is not a boolean
    );
    expect(ce.box(['Element', 2, 'string']).evaluate()).toMatchInlineSnapshot(
      `False` // 2 is not a string
    );
  });
});
