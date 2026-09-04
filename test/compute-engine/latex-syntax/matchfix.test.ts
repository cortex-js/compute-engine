import { ComputeEngine } from '../../../src/compute-engine';
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
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(check(`\\left\\lparen a, b, c\\right\\rparen`))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\mathopen(a, b, c\\mathclose)', () =>
    expect(check(`\\mathopen(a, b, c\\mathclose)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\mathopen\\lparen a, b, c\\mathclose\\rparen', () =>
    expect(check(`\\mathopen\\lparen a, b, c\\mathclose\\rparen`))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  // Braced form: \mathopen{(}
  test('\\mathopen{(}a, b, c\\mathclose{)}', () =>
    expect(check(`\\mathopen{(}a, b, c\\mathclose{)}`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "(,)"]
      canonical = ["Triple", "a", "b", "c"]
    `));
  test('\\mathopen{\\lbrack}1, 2\\mathclose{\\rbrack}', () =>
    expect(
      check(`\\mathopen{\\lbrack}1, 2\\mathclose{\\rbrack}`)
    ).toMatchInlineSnapshot(`["List", 1, 2]`));
});

describe('MATCHFIX null delimiter (\\right.)', () => {
  // `\right.` is a TeX *null delimiter*: a one-sided enclosure with no visible
  // closing fence. `\left(x\right.` should parse like `\left(x\right)`, not
  // error on an unmatched `\left`.
  test('\\sin\\left(x\\right.', () =>
    expect(check(`\\sin\\left(x\\right.`)).toMatchInlineSnapshot(
      `["Sin", "x"]`
    ));

  test('\\left(x\\right.', () =>
    expect(check(`\\left(x\\right.`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", "x"]
      canonical = x
    `));

  test('\\left(x+1\\right.', () =>
    expect(check(`\\left(x+1\\right.`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", "x", 1]]
      canonical = ["Add", "x", 1]
    `));

  test('\\left[x\\right.', () =>
    expect(check(`\\left[x\\right.`)).toMatchInlineSnapshot(`["List", "x"]`));

  test('\\bigl(x\\bigr.', () =>
    expect(check(`\\bigl(x\\bigr.`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", "x"]
      canonical = x
    `));

  // Regression: the null *open* delimiter (`\left.…\right|`, EvaluateAt) and
  // ordinary two-sided delimiters must keep working.
  test('\\left(x\\right) (two-sided still works)', () =>
    expect(check(`\\left(x\\right)`)).toMatchInlineSnapshot(`
      box       = ["Delimiter", "x"]
      canonical = x
    `));

  test('\\left.x^2\\right|_{x=2} (null open still works)', () =>
    expect(engine.parse(`\\left.x^2\\right|_{x=2}`).json)
      .toMatchInlineSnapshot(`
      [
        Subscript,
        [
          EvaluateAt,
          [
            Function,
            [
              Block,
              [
                Power,
                x,
                2,
              ],
            ],
            x,
          ],
        ],
        [
          Equal,
          x,
          2,
        ],
      ]
    `));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      box       = ["Add", 1, ["Abs", "a"], 2]
      canonical = ["Add", ["Abs", "a"], 3]
    `));

  test('|(1+|a|+2)|', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      box       = ["Abs", ["Delimiter", ["Add", 1, ["Abs", "a"], 2]]]
      canonical = ["Abs", ["Add", ["Abs", "a"], 3]]
      simplify  = |a| + 3
    `));

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      box       = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      canonical = ["Abs", ["Add", ["Abs", "a"], 3]]
      simplify  = |a| + 3
    `));

  test('||3-5|-4|', () => {
    const expr = engine.parse('||3-5|-4|');
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('2');
  });

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`
      box       = ["Norm", "a"]
      eval-auto = |a|
    `));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(`
      box       = ["Add", ["Norm", "a"], ["Abs", "b"]]
      eval-auto = |a| + |b|
    `));

  // `\|` is a LaTeX synonym for `\Vert` (renders ‖); should parse like
  // `||a||`, `\Vert a \Vert`, `\lVert a \rVert`.
  test('\\|a\\|', () =>
    expect(check('\\|a\\|')).toMatchInlineSnapshot(`
      box       = ["Norm", "a"]
      eval-auto = |a|
    `));

  test('\\left\\|a\\right\\|', () =>
    expect(check('\\left\\|a\\right\\|')).toMatchInlineSnapshot(`
      box       = ["Norm", "a"]
      eval-auto = |a|
    `));

  test('\\|a\\|+|b|', () =>
    expect(check('\\|a\\|+|b|')).toMatchInlineSnapshot(`
      box       = ["Add", ["Norm", "a"], ["Abs", "b"]]
      eval-auto = |a| + |b|
    `));
});

describe('MATCHFIX no redundant wrapping', () => {
  // When wrap() is called without a precedence, matchfix operators should not
  // be wrapped in additional parentheses since they already have visible
  // delimiters.

  test('Abs in reciprocal style (wrap without prec)', () => {
    // |x|^{-1} not (|x|)^{-1}
    const result = latex(['Divide', 1, ['Abs', 'x']]);
    expect(result).not.toContain('(\\vert');
    expect(result).not.toContain('\\vert)');
  });

  test('Floor in reciprocal style (wrap without prec)', () => {
    const result = latex(['Divide', 1, ['Floor', 'x']]);
    expect(result).not.toContain('(\\lfloor');
    expect(result).not.toContain('\\rfloor)');
  });

  test('Ceil in reciprocal style (wrap without prec)', () => {
    const result = latex(['Divide', 1, ['Ceil', 'x']]);
    expect(result).not.toContain('(\\lceil');
    expect(result).not.toContain('\\rceil)');
  });

  test('Abs serializes without extra parens', () => {
    expect(latex(['Abs', 'x'])).toMatchInlineSnapshot(`\\vert x\\vert`);
  });

  test('Floor serializes without extra parens', () => {
    expect(latex(['Floor', 'x'])).toMatchInlineSnapshot(`\\lfloor x\\rfloor`);
  });

  test('Ceil serializes without extra parens', () => {
    expect(latex(['Ceil', 'x'])).toMatchInlineSnapshot(`\\lceil x\\rceil`);
  });
});

describe('MATCHFIX invalid', () => {
  test('( // missing closing fence', () =>
    expect(check('(')).toMatchInlineSnapshot(
      `invalid   =["Error", "unexpected-delimiter", ["LatexString", "("]]`
    ));
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(
      `invalid   =["Error", "unexpected-delimiter", ["LatexString", ")"]]`
    );
  });

  test('-( // missing closing fence', () => {
    expect(engine.parse('-(')).toMatchInlineSnapshot(
      `["Negate", ["Error", "'missing'", ["LatexString", "-"]]]`
    );
  });

  test('(3+x // missing closing fence', () => {
    expect(engine.parse('(3+x')).toMatchInlineSnapshot(
      `["Error", "unexpected-delimiter", ["LatexString", "("]]`
    );
  });
});

describe('NORM ORDER SUBSCRIPT', () => {
  // A subscript on a norm is the ORDER of the norm: `‖v‖_1` is the L1 norm,
  // `‖v‖_\infty` the maximum norm, `‖v‖_F` the Frobenius norm. No subscript
  // is the 2-norm.
  const SPELLINGS = [
    (s: string) => `\\|v\\|${s}`,
    (s: string) => `\\left\\Vert v\\right\\Vert${s}`,
    (s: string) => `\\lVert v\\rVert${s}`,
    (s: string) => `||v||${s}`,
  ];

  const ORDERS: [string, any][] = [
    ['', null],
    ['_1', 1],
    ['_2', 2],
    ['_\\infty', 'PositiveInfinity'],
    ['_F', "'Frobenius'"],
    ['_3', 3],
  ];

  for (const spelling of SPELLINGS) {
    for (const [sub, order] of ORDERS) {
      const input = spelling(sub);
      test(`parse ${input}`, () => {
        expect(engine.parse(input, { canonical: false }).json).toEqual(
          order === null ? ['Norm', 'v'] : ['Norm', 'v', order]
        );
      });
    }
  }

  test('serialize: no order is the 2-norm', () => {
    expect(latex(['Norm', ['List', 3, 4]])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert'
    );
  });

  test('serialize: an explicit order of 2 has no subscript', () => {
    expect(latex(['Norm', ['List', 3, 4], 2])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert'
    );
  });

  test('serialize: order 1', () => {
    expect(latex(['Norm', ['List', 3, 4], 1])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_1'
    );
  });

  test('serialize: order infinity', () => {
    expect(latex(['Norm', ['List', 3, 4], 'PositiveInfinity'])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_\\infty'
    );
    expect(latex(['Norm', ['List', 3, 4], { str: 'Infinity' }])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_\\infty'
    );
  });

  test('serialize: Frobenius order', () => {
    expect(latex(['Norm', ['List', 3, 4], { str: 'Frobenius' }])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_F'
    );
  });

  test('serialize: a general order', () => {
    expect(latex(['Norm', ['List', 3, 4], 3])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_3'
    );
    expect(latex(['Norm', ['List', 3, 4], ['Divide', 3, 2]])).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_{\\frac{3}{2}}'
    );
  });

  // The order survives a serialize/parse round trip. An order of 2 is the
  // exception by design: it is written without a subscript, so it comes back
  // as the one-operand `Norm`, which is the same norm.
  for (const order of [
    1,
    'PositiveInfinity',
    { str: 'Frobenius' },
    3,
  ] as any[]) {
    test(`round trip of order ${JSON.stringify(order)}`, () => {
      const expr = engine.box(['Norm', ['List', 3, 4], order]);
      expect(engine.parse(expr.latex).isSame(expr)).toBe(true);
    });
  }

  test('round trip of the orders as values', () => {
    for (const [order, value] of [
      [1, '7'],
      [2, '5'],
      ['PositiveInfinity', '4'],
      [{ str: 'Frobenius' }, '5'],
    ] as [any, string][]) {
      const expr = engine.box(['Norm', ['List', 3, 4], order]);
      expect(expr.evaluate().toString()).toBe(value);
      expect(engine.parse(expr.latex).evaluate().toString()).toBe(value);
    }
  });

  // A norm with several subscripts is not one order, and is left as a
  // `Subscript` of the norm.
  test('a subscript of several scripts is not an order', () => {
    expect(engine.parse('\\|v\\|_{1,2}', { canonical: false }).json).toEqual([
      'Subscript',
      ['Norm', 'v'],
      ['Delimiter', ['Sequence', 1, 2], "','"],
    ]);
  });

  test('a bracketed list subscript is not an order', () => {
    expect(engine.parse('\\|v\\|_{[1,2]}', { canonical: false }).json).toEqual([
      'Subscript',
      ['Norm', 'v'],
      ['List', 1, 2],
    ]);
  });

  // A parenthesized order arrives wrapped in a `Delimiter`; the parentheses
  // are grouping, not a sequence, so the order inside them is the order.
  test('a parenthesized order is unwrapped', () => {
    expect(engine.parse('\\|v\\|_{(p+1)}', { canonical: false }).json).toEqual([
      'Norm',
      'v',
      ['Add', 'p', 1],
    ]);
    expect(engine.parse('\\|v\\|_{(1)}', { canonical: false }).json).toEqual([
      'Norm',
      'v',
      1,
    ]);
  });

  // A superscript is applied after the subscript, so a raised norm reaches the
  // rewrite as a `Power` around the subscripted norm.
  test('a raised norm keeps its order', () => {
    for (const input of ['\\|v\\|_1^2', '\\|v\\|^2_1']) {
      expect(engine.parse(input, { canonical: false }).json).toEqual([
        'Power',
        ['Norm', 'v', 1],
        2,
      ]);
    }
    // No subscript: the power is left exactly as it was.
    expect(engine.parse('\\|v\\|^2', { canonical: false }).json).toEqual([
      'Power',
      ['Norm', 'v'],
      2,
    ]);
  });

  test('a raised norm round-trips, and its order still counts', () => {
    const expr = engine.box(['Power', ['Norm', ['List', 3, 4], 1], 2]);
    expect(expr.latex).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_1^2'
    );
    expect(engine.parse(expr.latex).isSame(expr)).toBe(true);
    // 7² — the L1 norm squared, not the 2-norm squared (which would be 25).
    expect(expr.evaluate().toString()).toBe('49');
  });

  // A braced `_{F}` reaches the rewrite as a symbol object once the verbatim
  // LaTeX is preserved, so the Frobenius test has to read the symbol rather
  // than compare against the bare string.
  test('the Frobenius order survives preserveLatex', () => {
    const ce = new ComputeEngine();
    for (const input of ['\\|v\\|_F', '\\|v\\|_{F}']) {
      expect(
        ce.parse(input, { canonical: false, preserveLatex: true }).json
      ).toEqual(['Norm', 'v', "'Frobenius'"]);
    }
  });

  // The 2-norm is elided only for an EXACT literal 2. A machine-value test
  // would round `2.0000000000000001` to 2 and drop the subscript, and would
  // project the finite `1e400` to infinity and write the maximum norm.
  test('an order near 2 keeps its subscript', () => {
    // `Number('2.0000000000000001')` is exactly 2, so a machine-value test
    // cannot tell this order from the 2-norm.
    expect(Number('2.0000000000000001')).toBe(2);
    const expr = engine.box([
      'Norm',
      ['List', 3, 4],
      { num: '2.0000000000000001' },
    ]);
    expect(expr.latex).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert' +
        '_{2.000\\,000\\,000\\,000\\,000\\,1}'
    );
    expect(engine.parse(expr.latex, { canonical: false }).json).toEqual([
      'Norm',
      ['List', 3, 4],
      { num: '2.0000000000000001' },
    ]);
  });

  test('a finite order of huge magnitude is not the maximum norm', () => {
    // `Number('1e400')` is `Infinity`, so a machine-value test would write
    // `_\infty` for this finite order.
    expect(Number('1e400')).toBe(Infinity);
    const expr = engine.box(['Norm', ['List', 3, 4], { num: '1e400' }]);
    expect(expr.latex).toBe(
      '\\left\\Vert \\bigl\\lbrack3, 4\\bigr\\rbrack\\right\\Vert_{10^{400}}'
    );
    expect(expr.latex).not.toContain('\\infty');
  });

  // The matrix spelling (`Vmatrix`) carries the order too.
  test('a matrix norm carries its order', () => {
    const expr = engine.box([
      'Norm',
      ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]],
      1,
    ]);
    expect(expr.latex).toBe('\\begin{Vmatrix}1 & 2\\\\\n3 & 4\\end{Vmatrix}_1');
    expect(engine.parse(expr.latex).isSame(expr)).toBe(true);
  });
});
