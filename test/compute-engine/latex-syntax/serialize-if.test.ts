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

describe('IF - keywordStyle serialization option', () => {
  const expr = ce.box(['If', ['Greater', 'x', 0], 1, 0]);

  test("default ('text') is unchanged", () => {
    expect(expr.toLatex({ keywordStyle: 'text' })).toBe(
      '\\text{if }0\\lt x\\text{ then }1\\text{ else }0'
    );
  });

  test("'keyword' emits \\keyword{…} (no inner spacing)", () => {
    expect(expr.toLatex({ keywordStyle: 'keyword' })).toBe(
      '\\keyword{if}0\\lt x\\keyword{then}1\\keyword{else}0'
    );
  });

  test("'operatorname' emits \\operatorname{…}", () => {
    expect(expr.toLatex({ keywordStyle: 'operatorname' })).toBe(
      '\\operatorname{if}0\\lt x\\operatorname{then}1\\operatorname{else}0'
    );
  });

  test('keyword style round-trips back to the same expression', () => {
    const kw = expr.toLatex({ keywordStyle: 'keyword' });
    expect(ce.parse(kw).json).toEqual(['If', ['Less', 0, 'x'], 1, 0]);
  });

  test('Break / Continue / Return honor keywordStyle', () => {
    expect(ce.box(['Break']).toLatex({ keywordStyle: 'keyword' })).toBe(
      '\\keyword{break}'
    );
    expect(ce.box(['Continue']).toLatex({ keywordStyle: 'keyword' })).toBe(
      '\\keyword{continue}'
    );
    expect(ce.box(['Return', 5]).toLatex({ keywordStyle: 'keyword' })).toBe(
      '\\keyword{return}5'
    );
  });
});
