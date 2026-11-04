import { engine as ce, latex } from '../../utils';

describe('BLOCK - SERIALIZATION', () => {
  test('Block with Declare, Assign, and body', () => {
    expect(
      latex(['Block', ['Declare', 'x', "'unknown'", 5], ['Add', 'x', 1]])
    ).toMatchInlineSnapshot(`x+1\\text{ where }x\\coloneq5`);
  });

  test('Block with multiple assignments', () => {
    expect(
      latex([
        'Block',
        ['Declare', 'a', "'unknown'", 1],
        ['Declare', 'b', "'unknown'", 2],
        ['Add', 'a', 'b'],
      ])
    ).toMatchInlineSnapshot(`a+b\\text{ where }a\\coloneq1, b\\coloneq2`);
  });

  test('a parsed semicolon block of a local is written as a where clause', () => {
    const input = 'x \\coloneq 5; x + 1';
    const parsed = ce.parse(input);
    // The parsed local is `Declare(x, "unknown", 5)`, which is written as a
    // `where` clause.
    expect(parsed.latex).toMatchInlineSnapshot(`x+1\\text{ where }x\\coloneq5`);
  });

  test('Block round-trip: serialize → re-parse produces same expression', () => {
    const input = 'a \\coloneq x^2; a + 1';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });
});

describe('BLOCK - ROUND-TRIP', () => {
  test('multi-assignment block round-trips', () => {
    const input = 'a \\coloneq 1; b \\coloneq 2; a + b';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('assignment with power round-trips', () => {
    const input = 'x \\coloneq 10; x^2';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('assignment with fraction round-trips', () => {
    const input = 's \\coloneq a^2 + b^2; \\frac{a}{s}';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('subscripted variable in block round-trips', () => {
    const input = 'r_1 \\coloneq x^2 + y^2; \\frac{1}{r_1}';
    const parsed = ce.parse(input);
    expect(parsed.isValid).toBe(true);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('where clause round-trips', () => {
    const input = 'x^2 \\text{ where } x \\coloneq 5';
    const parsed = ce.parse(input);
    // Serialization may use semicolon form instead of "where" — that's fine
    // as long as re-parsing produces the same expression
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('where clause with multiple bindings round-trips', () => {
    const input = 'a + b \\text{ where } a \\coloneq 1, b \\coloneq 2';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  // A body written in a keyword form that reads a trailing expression (the
  // else branch of `if`, the body of `for`, the value of `return`) stops
  // before the `where`: the keyword's operands are read above the precedence
  // of `where`, so the binding covers the whole body.
  test.each([
    ['If', ['If', ['Less', 'x', 0], 'a', ['Add', 'x', 'a']]],
    ['Return', ['Return', ['Add', 'a', 1]]],
    [
      'Loop',
      ['Loop', ['Add', 'a', 'x'], ['Element', 'i', ['Range', 1, 'a']]],
    ],
  ])('where clause with a %s body round-trips', (_, body) => {
    const block = ['Block', ['Declare', 'a', "'unknown'", 2], body];
    const serialized = ce.box(block as any, { canonical: false }).latex;
    expect(serialized).toContain('\\text{ where }a\\coloneq2');
    expect(ce.parse(serialized, { canonical: false }).json).toEqual(block);
  });

  test('three-assignment block round-trips', () => {
    const input = 'a \\coloneq 1; b \\coloneq 2; c \\coloneq a + b; c^2';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });

  test('block with trig functions round-trips', () => {
    const input = 'r \\coloneq \\sqrt{x^2 + y^2}; \\sin(r)';
    const parsed = ce.parse(input);
    const serialized = parsed.latex;
    const reparsed = ce.parse(serialized);
    expect(reparsed.json).toEqual(parsed.json);
  });
});
