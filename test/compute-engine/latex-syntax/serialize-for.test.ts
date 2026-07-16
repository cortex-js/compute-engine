import { latex, engine } from '../../utils';

describe('FOR LOOP - SERIALIZATION', () => {
  test('Loop with Element/Range', () => {
    expect(
      latex(['Loop', ['Square', 'i'], ['Element', 'i', ['Range', 0, 9]]])
    ).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }0\\text{ to }9\\text{ do }i^2`
    );
  });

  test('Loop with expression bounds', () => {
    expect(
      latex([
        'Loop',
        ['Add', 'k', 1],
        ['Element', 'k', ['Range', 'n', ['Multiply', 2, 'n']]],
      ])
    ).toMatchInlineSnapshot(
      `\\text{for }k\\text{ from }n\\text{ to }2n\\text{ do }k+1`
    );
  });
});

describe('COMPREHENSION - SERIALIZATION', () => {
  // A canonical Comprehension is a lazy collection. Its `.latex` must be the
  // faithful comprehension form (not a materialized, elided preview List that
  // re-parses to a corrupt finite List). See Tycho item 22.
  test('canonical Comprehension serializes faithfully (not an elided List)', () => {
    expect(
      latex(['Comprehension', ['Power', 'n', 2], ['Element', 'n', ['Range', 1, 250]]])
    ).toMatchInlineSnapshot(`n^2 \\operatorname{for} n = 1..250`);
  });

  // Round-trip contract: parse(serialize(x)) structurally equals x.
  test.each([
    ['simple body', '\\lbrack n^2 \\operatorname{for} n = 1..250\\rbrack'],
    ['tuple body', '\\lbrack (n, n^2) \\operatorname{for} n = 1..10\\rbrack'],
    [
      'multiple Element clauses',
      '\\lbrack i+j \\operatorname{for} i = 1..3, j = 1..3\\rbrack',
    ],
    [
      'dependent domain',
      '\\lbrack (i,j) \\operatorname{for} i = 1..3, j = 1..i\\rbrack',
    ],
    ['infinite domain', '\\lbrack n^2 \\operatorname{for} n = 1..\\infty\\rbrack'],
  ])('round-trips: %s', (_label, src) => {
    const original = engine.parse(src);
    expect(original.operator).toBe('Comprehension');
    const roundTripped = engine.parse(original.latex);
    expect(roundTripped.operator).toBe('Comprehension');
    expect(roundTripped.isSame(original)).toBe(true);
  });
});

describe('BREAK / CONTINUE / RETURN - SERIALIZATION', () => {
  test('Break', () => {
    expect(latex(['Break'])).toMatchInlineSnapshot(`\\text{break}`);
  });

  test('Continue', () => {
    expect(latex(['Continue'])).toMatchInlineSnapshot(`\\text{continue}`);
  });

  test('Return with expression', () => {
    expect(latex(['Return', ['Add', 'x', 1]])).toMatchInlineSnapshot(
      `\\text{return }x+1`
    );
  });

  test('Return without expression', () => {
    expect(latex(['Return', 'Nothing'])).toMatchInlineSnapshot(
      `\\text{return}`
    );
  });
});
