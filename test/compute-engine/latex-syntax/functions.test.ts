import { engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

describe('Custom Function Parsing', () => {
  test('No arg list', () => expect(parse('f')).toMatchInlineSnapshot(`f`));
  test('Empty arg list', () =>
    expect(parse('f()')).toMatchInlineSnapshot(`["f"]`));
  test('Empty arg list', () =>
    expect(parse('f\\left(\\right)')).toMatchInlineSnapshot(`["f"]`));
  test('Single arg list', () =>
    expect(parse('f(1)')).toMatchInlineSnapshot(`["f", 1]`));
  test('Double arg list', () =>
    expect(parse('f\\left(1\\right)')).toMatchInlineSnapshot(`["f", 1]`));
  test('Double arg list', () =>
    expect(parse('f(1, 2)')).toMatchInlineSnapshot(`["f", 1, 2]`));
  test('Function of function', () =>
    expect(parse('f(1, \\sin(2))')).toMatchInlineSnapshot(
      `["f", 1, ["Sin", 2]]`
    ));
});

describe('Postfix operators: prime', () => {
  test('Single prime', () =>
    expect(parse("f'")).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('Single prime with arg', () =>
    expect(parse("f'()")).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('^\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('^\\prime', () =>
    expect(parse('f^\\prime()')).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('^{\\prime}', () =>
    expect(parse('f^{\\prime}()')).toMatchInlineSnapshot(
      `["Derivative", "f"]`
    ));
  test("f''", () =>
    expect(parse("f''()")).toMatchInlineSnapshot(`["Derivative", "f", 2]`));
  test('f\\doubleprime', () =>
    expect(parse('f\\doubleprime()')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    ));
  test('f^{\\doubleprime}', () =>
    expect(parse('f^{\\doubleprime}()')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    ));
});

describe('Anonymous functions, no arg', () => {
  test('no args with parens', () =>
    expect(parse('()\\mapsto 2')).toMatchInlineSnapshot(`["Function", 2]`));
});

describe('Anonymous functions, single arg', () => {
  test('Single arg no delims', () =>
    expect(parse('x\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
  test('Single arg regular parens', () =>
    expect(parse('(x)\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
  test('Single arg leftright', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
});

describe('Anonymous functions, anon params arg', () => {
  test('Single arg no delims', () =>
    expect(parse('()\\mapsto \\_')).toMatchInlineSnapshot(
      `["Function", "_1"]`
    ));
  test('Multiple arg', () =>
    expect(
      parse('()\\mapsto \\_ + \\operatorname{\\_2}')
    ).toMatchInlineSnapshot(`["Function", ["Add", "_1", "_2"]]`));
  // `()` is not an empty parameter list: the parameters are the wildcards of
  // the body, read off by canonicalization, so the literal applies.
  test('Wildcard parameters bind at application', () => {
    const f = ce.parse('()\\mapsto \\_ + \\operatorname{\\_2}');
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Add', '_1', '_2']],
      '_1',
      '_2',
    ]);
    expect(ce.box(['Apply', f.json, 3, 4]).evaluate().json).toBe(7);
  });
  test('No parameter and no wildcard is a function of no argument', () => {
    const f = ce.parse('()\\mapsto 2');
    expect(f.type.toString()).toBe('() -> integer');
    expect(ce.box(['Apply', f.json]).evaluate().json).toBe(2);
  });
  // The LaTeX of a wildcard-parameter literal is `()\mapsto body`; it reads
  // back as the same literal. A parameter list the wildcard reading would not
  // reconstruct (a named parameter, an unused or gapped `_k`) is printed.
  test('Wildcard-parameter literals round-trip through LaTeX', () => {
    const cases: [any, string][] = [
      [['Function', ['Add', '_1', 1]], '()\\mapsto\\operatorname{\\_1}+1'],
      [
        ['Function', ['Add', '_1', '_2']],
        '()\\mapsto\\operatorname{\\_1}+\\operatorname{\\_2}',
      ],
      [['Function', ['Add', 'x_1', 1], 'x_1'], 'x_1\\mapsto x_1+1'],
      [
        ['Function', ['Add', '_1', 1], '_1', '_2'],
        '(\\operatorname{\\_1}, \\operatorname{\\_2})\\mapsto\\operatorname{\\_1}+1',
      ],
      [
        ['Function', ['Add', '_2', 1], '_2'],
        '\\operatorname{\\_2}\\mapsto\\operatorname{\\_2}+1',
      ],
      // A free wildcard outside the parameter list: the wildcard reading
      // would capture `_2` and make this a function of two arguments.
      [
        ['Function', ['Add', '_1', '_2'], '_1'],
        '\\operatorname{\\_1}\\mapsto\\operatorname{\\_1}+\\operatorname{\\_2}',
      ],
    ];
    for (const [json, latex] of cases) {
      const f = ce.box(json);
      expect(f.latex).toBe(latex);
      expect(ce.parse(f.latex).isSame(f)).toBe(true);
    }
    // The wildcard reading stops at `_9`: a list of ten parameters is
    // printed in full.
    const ten = Array.from({ length: 10 }, (_, i) => `_${i + 1}`);
    const f10 = ce.box(['Function', ['Add', ...ten], ...ten]);
    expect((f10.toMathJson() as any[]).slice(2)).toEqual(ten);
    expect(ce.box(f10.toMathJson()).isSame(f10)).toBe(true);
  });
});

describe('Anonymous functions, multiple args', () => {
  test('Multiple args', () =>
    expect(parse('(x, y) \\mapsto x + y')).toMatchInlineSnapshot(
      `["Function", ["Add", "x", "y"], "x", "y"]`
    ));
  test('Multiple args', () =>
    expect(parse('\\left(x\\right)\\mapsto x + y')).toMatchInlineSnapshot(
      `["Function", ["Add", "x", "y"], "x"]`
    ));
});

describe('Invalid', () => {
  test('Parens around arguments required', () =>
    expect(parse('x, y\\mapsto x + y')).toMatchInlineSnapshot(
      `["Pair", "x", ["Function", ["Add", "x", "y"], "y"]]`
    ));
});
