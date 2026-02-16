import { engine as ce } from '../../utils';

describe('IF - PARSING', () => {
  test('Simple \\text{if} expression', () => {
    expect(
      ce.parse('\\text{if } x > 0 \\text{ then } x^2 \\text{ else } -x')
    ).toMatchInlineSnapshot(
      `["If", ["Less", 0, "x"], ["Square", "x"], ["Negate", "x"]]`
    );
  });

  test('\\operatorname{if} expression', () => {
    expect(
      ce.parse(
        '\\operatorname{if} x > 0 \\operatorname{then} x^2 \\operatorname{else} -x'
      )
    ).toMatchInlineSnapshot(
      `["If", ["Less", 0, "x"], ["Square", "x"], ["Negate", "x"]]`
    );
  });

  test('Spaces inside \\text braces', () => {
    expect(
      ce.parse('\\text{ if } x > 0 \\text{ then } 1 \\text{ else } 0')
    ).toMatchInlineSnapshot(`["If", ["Less", 0, "x"], 1, 0]`);
  });

  test('Nested if expressions', () => {
    expect(
      ce.parse(
        '\\text{if } a \\text{ then } \\text{if } b \\text{ then } c \\text{ else } d \\text{ else } g'
      )
    ).toMatchInlineSnapshot(`["If", "a", ["If", "b", "c", "d"], "g"]`);
  });

  test('If with numeric branches', () => {
    expect(
      ce.parse('\\text{if } x > 0 \\text{ then } 1 \\text{ else } 0')
    ).toMatchInlineSnapshot(`["If", ["Less", 0, "x"], 1, 0]`);
  });

  test('\\text{iffy} is still parsed as String', () => {
    // \text{iffy} should NOT trigger If parsing
    expect(ce.parse('\\text{iffy}')).toMatchInlineSnapshot(`'iffy'`);
  });

  test('\\text{information} is still parsed as String', () => {
    // \text{information} should NOT trigger If parsing
    expect(ce.parse('\\text{information}')).toMatchInlineSnapshot(
      `'information'`
    );
  });

  test('Mixed \\text and \\operatorname keywords', () => {
    expect(
      ce.parse(
        '\\text{if } x > 0 \\operatorname{then} x^2 \\text{ else } -x'
      )
    ).toMatchInlineSnapshot(
      `["If", ["Less", 0, "x"], ["Square", "x"], ["Negate", "x"]]`
    );
  });
});
