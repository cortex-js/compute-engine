import { latex, check, engine } from '../../utils.ts';

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
    expect(check('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      box       = ["Sin", ["List", "a", ["List", "b", "c"]]]
      eval-auto = [sin(a),[sin(b),sin(c)]]
    `));
});

describe('MATCHFIX serialize', () => {
  test('[List]', () =>
    expect(latex(['List'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack \\bigr\\rbrack`
    ));

  test('[List, "a"]', () =>
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a\\bigr\\rbrack`
    ));

  test(`['List', 'a', 'b']`, () =>
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a, b\\bigr\\rbrack`
    ));

  test(`['List', 'a', ['List', 'b', 'c']`, () =>
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a, \\bigl\\lbrack b, c\\bigr\\rbrack\\bigr\\rbrack`
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
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(check(`\\left\\lparen a, b, c\\right\\rparen`))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
    `));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      box       = ["Add", 1, ["Abs", "a"], 2]
      canonical = ["Add", ["Abs", "a"], 1, 2]
      simplify  = |a| + 3
    `));

  test('|(1+|a|+2)|', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      box       = ["Abs", ["Delimiter", ["Add", 1, ["Abs", "a"], 2]]]
      canonical = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ||a| + 3|
    `)); // @fixme: simplify should be |a| + 3

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      box       = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      canonical = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ||a| + 3|
    `)); // @fixme: simplify should be |a| + 3

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`["Norm", "a"]`));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(`
      invalid   =[
        "Add",
        [
          "Error",
          ["ErrorCode", "'incompatible-type'", "'number'", "'function'"]
        ],
        ["Abs", "b"]
      ]
    `));
}); // @fixme: should parse as ["Add", ["Norm", "a"], ["Abs", "b"]]

describe('MATCHFIX invalid', () => {
  test('( // missing closing fence', () =>
    expect(check('(')).toMatchInlineSnapshot(
      `invalid   =["Error", "'unexpected-delimiter'", ["LatexString", "'('"]]`
    ));
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(
      `invalid   =["Error", "'unexpected-delimiter'", ["LatexString", "')'"]]`
    );
  });

  test('-( // missing closing fence', () => {
    expect(engine.parse('-(')).toMatchInlineSnapshot(
      `["Negate", ["Error", "'missing'", ["LatexString", "'-'"]]]`
    );
  });

  test('(3+x // missing closing fence', () => {
    expect(engine.parse('(3+x')).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'('"]]`
    );
  });
});
