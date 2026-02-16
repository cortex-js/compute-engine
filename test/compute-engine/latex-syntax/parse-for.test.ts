import { engine as ce } from '../../utils';

describe('FOR LOOP - PARSING', () => {
  test('Simple \\text{for} expression', () => {
    expect(
      ce.parse(
        '\\text{for } i \\text{ from } 0 \\text{ to } 9 \\text{ do } i^2'
      )
    ).toMatchInlineSnapshot(
      `["Loop", ["Square", "i"], ["Element", "i", ["Range", 0, 9]]]`
    );
  });

  test('\\operatorname{for} variant', () => {
    expect(
      ce.parse(
        '\\operatorname{for} i \\operatorname{from} 0 \\operatorname{to} 9 \\operatorname{do} i^2'
      )
    ).toMatchInlineSnapshot(
      `["Loop", ["Square", "i"], ["Element", "i", ["Range", 0, 9]]]`
    );
  });

  test('Spaces inside \\text braces', () => {
    expect(
      ce.parse(
        '\\text{ for } i \\text{ from } 1 \\text{ to } 5 \\text{ do } i+1'
      )
    ).toMatchInlineSnapshot(
      `["Loop", ["Add", "i", 1], ["Element", "i", ["Range", 1, 5]]]`
    );
  });

  test('For with expression bounds', () => {
    expect(
      ce.parse(
        '\\text{for } k \\text{ from } n \\text{ to } 2n \\text{ do } k^2'
      )
    ).toMatchInlineSnapshot(`
      [
        "Loop",
        ["Square", "k"],
        ["Element", "k", ["Range", "n", ["InvisibleOperator", 2, "n"]]]
      ]
    `);
  });
});

describe('BREAK / CONTINUE / RETURN - PARSING', () => {
  test('\\text{break}', () => {
    expect(ce.parse('\\text{break}')).toMatchInlineSnapshot(`["Break"]`);
  });

  test('\\text{continue}', () => {
    expect(ce.parse('\\text{continue}')).toMatchInlineSnapshot(
      `["Continue"]`
    );
  });

  test('\\text{return} with expression', () => {
    expect(ce.parse('\\text{return } x + 1')).toMatchInlineSnapshot(
      `["Return", ["Add", "x", 1]]`
    );
  });

  test('\\operatorname{break}', () => {
    expect(ce.parse('\\operatorname{break}')).toMatchInlineSnapshot(
      `["Break"]`
    );
  });

  test('\\operatorname{continue}', () => {
    expect(ce.parse('\\operatorname{continue}')).toMatchInlineSnapshot(
      `["Continue"]`
    );
  });

  test('\\operatorname{return} with expression', () => {
    expect(
      ce.parse('\\operatorname{return} x + 1')
    ).toMatchInlineSnapshot(`["Return", ["Add", "x", 1]]`);
  });

  test('\\text{format} stays as String (not keyword match)', () => {
    expect(ce.parse('\\text{format}')).toMatchInlineSnapshot(`'format'`);
  });

  test('\\text{broken} stays as String', () => {
    expect(ce.parse('\\text{broken}')).toMatchInlineSnapshot(`'broken'`);
  });

  test('\\text{fortune} stays as String', () => {
    expect(ce.parse('\\text{fortune}')).toMatchInlineSnapshot(`'fortune'`);
  });

  test('\\text{continued} stays as String', () => {
    expect(ce.parse('\\text{continued}')).toMatchInlineSnapshot(
      `'continued'`
    );
  });
});
