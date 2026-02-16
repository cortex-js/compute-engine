import { engine as ce, latex } from '../../utils';

describe('IF - SERIALIZATION', () => {
  test('Simple If serialization', () => {
    expect(latex(['If', ['Greater', 'x', 0], 1, 0])).toMatchInlineSnapshot(
      `\\text{if }0\\lt x\\text{ then }1\\text{ else }0`
    );
  });

  test('If with complex branches', () => {
    expect(
      latex(['If', ['Greater', 'x', 0], ['Power', 'x', 2], ['Negate', 'x']])
    ).toMatchInlineSnapshot(
      `\\text{if }0\\lt x\\text{ then }x^2\\text{ else }-x`
    );
  });

  test('Nested If serialization', () => {
    expect(
      latex(['If', 'a', ['If', 'b', 'c', 'd'], 'g'])
    ).toMatchInlineSnapshot(
      `\\text{if }a\\text{ then }\\text{if }b\\text{ then }c\\text{ else }d\\text{ else }g`
    );
  });

  test('Round-trip: parse then serialize', () => {
    const input = '\\text{if }x>0\\text{ then }1\\text{ else }0';
    const parsed = ce.parse(input);
    expect(parsed.latex).toMatchInlineSnapshot(
      `\\text{if }0\\lt x\\text{ then }1\\text{ else }0`
    );
  });

  test('Round-trip: serialize then parse preserves MathJSON', () => {
    const expr = [
      'If',
      ['Greater', 'x', 0],
      ['Power', 'x', 2],
      ['Negate', 'x'],
    ];
    const serialized = latex(expr);
    const reparsed = ce.parse(serialized);
    expect(reparsed).toMatchInlineSnapshot(
      `["If", ["Less", 0, "x"], ["Square", "x"], ["Negate", "x"]]`
    );
  });
});
