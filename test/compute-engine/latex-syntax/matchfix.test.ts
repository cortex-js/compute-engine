import { latex, check, engine } from '../../utils';

describe('MATCHFIX', () => {
  test('\\lbrack\\rbrack', () =>
    expect(check('\\lbrack\\rbrack')).toMatchInlineSnapshot(`["List"]`));

  test('\\lbrack a\\rbrack', () =>
    expect(check('\\lbrack a\\rbrack')).toMatchInlineSnapshot(`["List", "a"]`));

  test('\\lbrack a, b\\rbrack', () =>
    expect(check('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(
      `["List", "a", "b"]`
    ));

  test('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(
      check('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(`["List", "a", ["List", "b", "c"]]`));

  test('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(
      check('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(`["Sin", ["List", "a", ["List", "b", "c"]]]`));
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
    expect(check(`(a, b, c)`)).toMatchInlineSnapshot(
      `["Delimiter", ["List", "a", "b", "c"]]`
    ));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(
      `["Delimiter", ["List", "a", "b", "c"]]`
    ));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(
      `["Delimiter", ["List", "a", "b", "c"]]`
    ));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(
      `["Delimiter", ["List", "a", "b", "c"]]`
    ));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(
      `["Delimiter", ["List", "a", "b", "c"]]`
    ));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(
      check(`\\left\\lparen a, b, c\\right\\rparen`)
    ).toMatchInlineSnapshot(`["Delimiter", ["List", "a", "b", "c"]]`));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      box      = ["Add", 1, ["Abs", "a"], 2]
      simplify  = ["Add", 3, ["Abs", "a"]]
    `));

  test('|(1+|a|+2)|', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      box      = ["Abs", ["Delimiter", ["Add", 1, ["Abs", "a"], 2]]]
      canonical = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      simplify  = ["Add", 3, ["Abs", "a"]]
      evaluate  = ["Abs", ["Add", 3, ["Abs", "a"]]]
    `));

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      box      = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      simplify  = ["Add", 3, ["Abs", "a"]]
      evaluate  = ["Abs", ["Add", 3, ["Abs", "a"]]]
    `));

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`["Norm", "a"]`));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(
      `["Add", ["Norm", "a"], ["Abs", "b"]]`
    ));
});

describe('MATCHFIX invalid', () => {
  // @todo
  test('( // missing closing fence', () =>
    expect(check('(')).toMatchInlineSnapshot(`["Sequence"]`));
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(
      `["Error", ["ErrorCode", "'unexpected-token'", "')'"], ["Latex", "')'"]]`
    );
  });

  test('-( // missing closing fence', () => {
    expect(engine.parse('-(').json).toMatchInlineSnapshot(
      `["Negate", ["Error", "'missing'", ["Latex", "'-('"]]]`
    );
  });

  test('(3+x // missing closing fence', () => {
    expect(engine.parse('(3+x').json).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'3'"],
        ["Latex", "'3+x'"]
      ]
    `);
  });
});
