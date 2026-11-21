import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

describe('WHICH', () => {
  test('Valid forms', () => {
    expect(
      ce.parse(`\\begin{cases}
      0 & n =  0\\\\
      1 & n =  1\\\\
      n^2+1 & n \\geq 2   \\end{cases}`)
    ).toMatchInlineSnapshot(`
      [
        "Which",
        ["Equal", "n", 0],
        0,
        ["Equal", "n", 1],
        1,
        ["LessEqual", 2, "n"],
        ["Add", ["Square", "n"], 1]
      ]
    `);
  });

  test('\\keyword{otherwise} / \\keyword{else} act as the default branch', () => {
    const withText = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\text{otherwise} \\end{cases}'
    ).json;
    const withKeywordOtherwise = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\keyword{otherwise} \\end{cases}'
    ).json;
    const withKeywordElse = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\keyword{else} \\end{cases}'
    ).json;

    // The default branch is marked by a `True` condition.
    expect(withKeywordOtherwise).toEqual([
      'Which',
      ['Less', 0, 'x'],
      'x',
      'True',
      ['Negate', 'x'],
    ]);
    // All spellings produce the same expression.
    expect(withKeywordOtherwise).toEqual(withText);
    expect(withKeywordElse).toEqual(withText);
  });

  test('An entirely empty row is not a clause; an authored Nothing default is kept', () => {
    expect(ce.parse('\\begin{cases}x & x>0 \\\\ &\\end{cases}').json).toEqual(
      ['Which', ['Less', 0, 'x'], 'x']
    );
    expect(
      ce.parse(
        '\\begin{cases}x & x>0 \\\\ \\operatorname{Nothing} & \\text{otherwise}\\end{cases}'
      ).json
    ).toEqual(['Which', ['Less', 0, 'x'], 'x', 'True', 'Nothing']);
  });

  // CE-1632: a string operand of a relation in a condition is a value, not
  // an annotation, and is kept.
  test('A relation with a text operand in a condition keeps the operand', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('m', 'string');
    ce2.declare('x', 'real');
    const cases = (cond: string) =>
      `\\begin{cases} x^3 & ${cond} \\\\ x & \\text{otherwise} \\end{cases}`;
    const expected = [
      'Which',
      ['Equal', 'm', "'cubic'"],
      ['Power', 'x', 3],
      'True',
      'x',
    ];
    expect(ce2.parse(cases('m = \\text{cubic}')).json).toEqual(expected);
    expect(ce2.parse(cases('\\text{if } m = \\text{cubic}')).json).toEqual(
      expected
    );
    expect(ce2.parse(cases('m \\ne \\text{lin}')).json).toEqual([
      'Which',
      ['NotEqual', 'm', "'lin'"],
      ['Power', 'x', 3],
      'True',
      'x',
    ]);
    // A string in a tuple or in the arguments of a call is a value too.
    expect(ce2.parse(cases('(m, n) = (\\text{a}, \\text{b})')).json).toEqual([
      'Which',
      ['Equal', ['Tuple', 'm', 'n'], ['Tuple', "'a'", "'b'"]],
      ['Power', 'x', 3],
      'True',
      'x',
    ]);
    expect(ce2.parse(cases('f(\\text{a}, x) > 0')).json).toEqual([
      'Which',
      ['Less', 0, ['f', "'a'", 'x']],
      ['Power', 'x', 3],
      'True',
      'x',
    ]);
    // A text annotation juxtaposed with math, or after a comma, is still
    // removed.
    for (const cond of ['x > 0 \\text{ (strict)}', 'x > 0, \\text{strict}'])
      expect(ce2.parse(cases(cond)).json).toEqual([
        'Which',
        ['Less', 0, 'x'],
        ['Power', 'x', 3],
        'True',
        'x',
      ]);

    const expr = ce2.parse(cases('m = \\text{cubic}'));
    ce2.assign('x', 2);
    ce2.assign('m', ce2.expr({ str: 'lin' }));
    expect(expr.evaluate().json).toEqual(2);
    ce2.assign('m', ce2.expr({ str: 'cubic' }));
    expect(expr.evaluate().json).toEqual(8);
  });
});
