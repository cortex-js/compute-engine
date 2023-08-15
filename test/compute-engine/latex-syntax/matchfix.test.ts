import { latex, check, engine } from '../../utils';

describe('MATCHFIX', () => {
  test('\\lbrack\\rbrack', () =>
    expect(check('\\lbrack\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List"]
      ["List"]
    `));

  test('\\lbrack a\\rbrack', () =>
    expect(check('\\lbrack a\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List", "a"]
      ["List", "a"]
    `));

  test('\\lbrack a, b\\rbrack', () =>
    expect(check('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List", "a", "b"]
      ["List", "a", "b"]
    `));

  test('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      latex     = ["List", "a", ["List", "b", "c"]]
      ["List", "a", ["List", "b", "c"]]
    `));

  test('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      latex     = ["Sin", ["List", "a", ["List", "b", "c"]]]
      [
        "Sin",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "List"]
          ],
          ["List", "a", ["List", "b", "c"]]
        ]
      ]
    `));
});

describe('MATCHFIX serialize', () => {
  test('[List]', () =>
    expect(latex(['List'])).toMatchInlineSnapshot(`\\lbrack\\rbrack`));

  test('[List, "a"]', () =>
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(`\\lbrack a\\rbrack`));

  test(`['List', 'a', 'b']`, () =>
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `\\lbrack a, b\\rbrack`
    ));

  test(`['List', 'a', ['List', 'b', 'c']`, () =>
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `\\lbrack a, \\lbrack b, c\\rbrack\\rbrack`
    ));
});

describe('MATCHFIX synonyms', () => {
  // A given matchfix operators has automatic synonyms:
  // () -> \left(\right)
  //    -> \bigl(\bigr)
  //    -> \lparen\rparen
  //    -> etc...

  test('(a, b, c)', () =>
    expect(check(`(a, b, c)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(check(`\\left\\lparen a, b, c\\right\\rparen`))
      .toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, ["Abs", "a"], 2]
      box       = ["Add", ["Abs", "a"], 1, 2]
      simplify  = ["Add", ["Abs", "a"], 3]
    `));

  test('|(1+|a|+2)|', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      latex     = ["Abs", ["Delimiter", ["Add", 1, ["Abs", "a"], 2]]]
      box       = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ["Add", ["Abs", "a"], 3]
    `));

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      latex     = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      box       = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ["Add", ["Abs", "a"], 3]
    `));

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`
      latex     = ["Norm", "a"]
      ["Norm", "a"]
    `));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Norm", "a"], ["Abs", "b"]]
      ["Add", ["Abs", "b"], ["Norm", "a"]]
    `));
});

describe('MATCHFIX invalid', () => {
  test('( // missing closing fence', () =>
    expect(check('(')).toMatchInlineSnapshot(`
      latex     = [
        "Error",
        ["ErrorCode", "'expected-close-delimiter'", "')'"],
        ["Latex", "'('"]
      ]
      [
        "Error",
        ["ErrorCode", "'expected-close-delimiter'", "')'"],
        ["Latex", "'('"]
      ]
    `));
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(`
      latex     = [
        "Error",
        ["ErrorCode", "'expected-open-delimiter'", "'('"],
        ["Latex", "')'"]
      ]
      [
        "Error",
        ["ErrorCode", "'expected-open-delimiter'", "'('"],
        ["Latex", "')'"]
      ]
    `);
  });

  test('-( // missing closing fence', () => {
    expect(engine.parse('-(').json).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Negate", ["Error", "'missing'"]],
        [
          "Error",
          ["ErrorCode", "'expected-close-delimiter'", "')'"],
          ["Latex", "'('"]
        ]
      ]
    `);
  });

  test('(3+x // missing closing fence', () => {
    expect(engine.parse('(3+x').json).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'expected-close-delimiter'", "')'"],
        ["Latex", "'('"]
      ]
    `);
  });
});
