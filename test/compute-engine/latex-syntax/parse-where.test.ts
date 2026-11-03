import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

describe('WHERE - PARSING', () => {
  test('Simple \\text{where} expression', () => {
    expect(ce.parse('x^2 \\text{ where } x \\coloneq 5')).toMatchInlineSnapshot(
      `["Block", ["Declare", "x", "'unknown'", 5], ["Square", "x"]]`
    );
  });

  test('Multiple bindings with comma', () => {
    expect(ce.parse('a + b \\text{ where } a \\coloneq 1, b \\coloneq 2'))
      .toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a", "'unknown'", 1],
        ["Declare", "b", "'unknown'", 2],
        ["Add", "a", "b"]
      ]
    `);
  });

  test('the value of a subscripted binding reads the new local', () => {
    // With `n` a list, `n_{1}` is first read as `At(n, 1)`. The binding
    // declares the local `n_1` before its value is read, so the value and
    // the body read the same local, as in the `;` form.
    const ce2 = new ComputeEngine();
    ce2.declare('n', 'list<integer>');
    const where = ce2.parse('n_{1} \\text{ where } n_{1} \\coloneq n_{1}+1', {
      canonical: false,
    }).json;
    expect(where).toEqual([
      'Block',
      ['Declare', 'n_1', "'unknown'", ['Add', 'n_1', 1]],
      'n_1',
    ]);
    expect(
      ce2.parse('n_{1} \\coloneq n_{1}+1; n_{1}', { canonical: false }).json
    ).toEqual(where);
  });

  test('\\operatorname{where} variant', () => {
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x", "'unknown'", 5], ["Square", "x"]]`
    );
  });

  test('\\text{wherever} stays as text (not a keyword match)', () => {
    expect(ce.parse('\\text{wherever}')).toMatchInlineSnapshot(`'wherever'`);
  });

  test('\\text{where} without lhs is parsed as text', () => {
    expect(ce.parse('\\text{where}')).toMatchInlineSnapshot(`'where'`);
  });

  test('5 \\text{cm} still works (invisible multiply with text)', () => {
    // Regression: \text-triggered infix should not block invisible operator
    expect(ce.parse('5\\text{cm}')).toMatchInlineSnapshot(
      `["Quantity", 5, "cm"]`
    );
  });

  test('Visual spacing (\\;) between comma-separated bindings', () => {
    expect(ce.parse('x + y \\text{ where } a \\coloneq 1,\\; b \\coloneq 2'))
      .toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a", "'unknown'", 1],
        ["Declare", "b", "'unknown'", 2],
        ["Add", "x", "y"]
      ]
    `);
  });

  test('Where with complex body', () => {
    expect(ce.parse('x^2 + y^2 \\text{ where } x \\coloneq 3, y \\coloneq 4'))
      .toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "x", "'unknown'", 3],
        ["Declare", "y", "'unknown'", 4],
        ["Add", ["Square", "x"], ["Square", "y"]]
      ]
    `);
  });
});

describe('WHERE - EVALUATION', () => {
  test('Simple where expression evaluates', () => {
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5').evaluate().re
    ).toEqual(25);
  });

  test('Multiple bindings evaluate sequentially', () => {
    expect(
      ce
        .parse('b \\operatorname{where} a \\coloneq 5, b \\coloneq a + 1')
        .evaluate().re
    ).toEqual(6);
  });

  test('where-clause does not leak bindings to outer scope', () => {
    ce.pushScope();
    try {
      ce.assign('x', 100);
      // Inside the where-clause, x is shadowed to 7.
      expect(
        ce.parse('x \\operatorname{where} x \\coloneq 7').evaluate().re
      ).toEqual(7);
      // After the clause, outer x is unchanged.
      expect(ce.expr('x').evaluate().re).toEqual(100);
    } finally {
      ce.popScope();
    }
  });
});

describe('WHERE - DICTIONARY VALUE', () => {
  // `Declare` reads a trailing `Dictionary` operand as its attributes, so a
  // binding to a dictionary literal is written in the attributes form, with
  // the dictionary in its `value` entry.
  const DICT =
    '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{x}, 1))';
  const VALUE_KEY =
    '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{value}, 5))';

  test('a where binding gives the whole dictionary', () => {
    expect(
      ce.parse(`a \\text{ where } a \\coloneq ${DICT}`).evaluate().json
    ).toEqual({ dict: { x: 1 } });
  });

  test('a dictionary with a value key is not read as attributes', () => {
    expect(ce.parse(`a \\coloneq ${VALUE_KEY}; a`).evaluate().json).toEqual({
      dict: { value: 5 },
    });
  });

  test('MathJSON Declare with the attributes form', () => {
    const dict = ['Dictionary', ['KeyValuePair', "'x'", 1]];
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'a', ['Dictionary', ['KeyValuePair', "'value'", dict]]],
          'a',
        ])
        .evaluate().json
    ).toEqual({ dict: { x: 1 } });
  });

  test('the binding is written with where and reads back', () => {
    const latex = `a \\text{ where } a \\coloneq ${VALUE_KEY}`;
    for (const canonical of [false, true]) {
      const expr = ce.parse(latex, { canonical });
      const text = expr.latex;
      expect(text).toMatch(/\\text\{ where \}a\\coloneq\\operatorname\{Dictionary\}/);
      expect(ce.parse(text, { canonical }).json).toEqual(expr.json);
    }
  });
});
