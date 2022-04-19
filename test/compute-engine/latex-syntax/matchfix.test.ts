import { latex, expressionError, check } from '../../utils';

describe('MATCHFIX', () => {
  test('\\lbrack\\rbrack', () =>
    expect(check('\\lbrack\\rbrack')).toMatchInlineSnapshot(`
      'box      = ["Error", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]], "'syntax-error'", ["LatexForm", "'\\rbrack'"]]
      simplify  = ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]
      evaluate  = "Missing"'
    `));

  test('\\lbrack a\\rbrack', () =>
    expect(check('\\lbrack a\\rbrack')).toMatchInlineSnapshot(`
      'box      = ["Error", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]], "'syntax-error'", ["LatexForm", "'a\\rbrack'"]]
      simplify  = ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]
      evaluate  = "Missing"'
    `));

  test('\\lbrack a, b\\rbrack', () =>
    expect(check('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(`
      'box      = ["Error", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]], "'syntax-error'", ["LatexForm", "'a, b\\rbrack'"]]
      simplify  = ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]
      evaluate  = "Missing"'
    `));

  test('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      'box      = ["Error", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]], "'syntax-error'", ["LatexForm", "'a, \\lbrack b, c\\rbrack\\rbrack'"]]
      simplify  = ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]
      evaluate  = "Missing"'
    `));

  test('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      'box      = ["Error", ["Sequence", ["Multiply", ["Sin", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]], "a"], ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]], "'syntax-error'", ["LatexForm", "'b, c\\rbrack\\rbrack'"]]
      simplify  = ["Sequence", ["Multiply", ["Sin", ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]], "a"], ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\lbrack'"]]]
      evaluate  = ["Sequence", ["Divide", ["Multiply", "a", ["Subtract", ["Exp", ["Multiply", "ImaginaryUnit", "Missing"]], ["Exp", ["Negate", ["Multiply", "ImaginaryUnit", "Missing"]]]]], ["Complex", 0, 2]], "Missing"]'
    `)); // @todo
});

describe('MATCHFIX serialize', () => {
  test('[List]', () =>
    expect(latex(['List'])).toMatchInlineSnapshot(
      `'\\left[\\begin{array}{lll}\\end{array}\\right]'`
    ));

  test('[List, "a"]', () =>
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(
      `'\\left[\\begin{array}{lll}\\end{array}\\right]'`
    ));

  test(`['List', 'a', 'b']`, () =>
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `'\\left[\\begin{array}{lll}\\end{array}\\right]'`
    ));

  test(`['List', 'a', ['List', 'b', 'c']`, () =>
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `'\\left[\\begin{array}{lll}\\end{array}\\right]'`
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
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(`
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(`
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(`
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(`
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(check(`\\left\\lparen a, b, c\\right\\rparen`))
      .toMatchInlineSnapshot(`
      'box      = ["Delimiter", "a", "b", "c"]
      canonical = "a"'
    `));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      'box      = ["Error", 1, "'syntax-error'", ["LatexForm", "'+|a|+2'"]]
      simplify  = 1'
    `));

  test('1+|a|+2', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "'|(1+|a|+2)|'"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "'|(1+|a|+2)|'"]]
      simplify  = "'syntax-error'"'
    `)); // @todo

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "'|1+|a|+2|'"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "'|1+|a|+2|'"]]
      simplify  = "'syntax-error'"'
    `));

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "'||a||'"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "'||a||'"]]
      simplify  = "'syntax-error'"'
    `));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "'||a||+|b|'"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "'||a||+|b|'"]]
      simplify  = "'syntax-error'"'
    `));
});

describe('MATCHFIX invalid', () => {
  test('( // missing closing fence', () => {
    expect(check('(')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "'('"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "'('"]]
      simplify  = "'syntax-error'"'
    `);
  });
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(`
      'box      = ["Error", "Nothing", "'syntax-error'", ["LatexForm", "')'"]]
      canonical = ["Error", "'syntax-error'", ["LatexForm", "')'"]]
      simplify  = "'syntax-error'"'
    `);
  });

  test('-( // missing closing fence', () => {
    expect(expressionError('-(')).toMatchInlineSnapshot(`[]`);
  });

  test('(3+x // missing closing fence', () => {
    expect(expressionError('(3+x')).toMatchInlineSnapshot(`[]`);
  });
});
