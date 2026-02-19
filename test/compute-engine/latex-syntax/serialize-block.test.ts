import { engine as ce, latex } from '../../utils';

describe('BLOCK - SERIALIZATION', () => {
  test('Block with Declare, Assign, and body', () => {
    expect(
      latex(['Block', ['Declare', 'x'], ['Assign', 'x', 5], ['Add', 'x', 1]])
    ).toMatchInlineSnapshot(`x\\coloneq5; x+1`);
  });

  test('Block with multiple assignments', () => {
    expect(
      latex([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', 1],
        ['Declare', 'b'],
        ['Assign', 'b', 2],
        ['Add', 'a', 'b'],
      ])
    ).toMatchInlineSnapshot(`a\\coloneq1; b\\coloneq2; a+b`);
  });

  test('Block round-trip via semicolons', () => {
    const input = 'x \\coloneq 5; x + 1';
    const parsed = ce.parse(input);
    expect(parsed.latex).toMatchInlineSnapshot(`x\\coloneq5; x+1`);
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
