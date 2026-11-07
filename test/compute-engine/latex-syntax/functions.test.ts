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
  // The LaTeX of a wildcard-parameter literal writes the wildcards of the body
  // as its parameters (`\_1\mapsto body`, not `()\mapsto body`, which looks
  // like a function of no argument); it reads back as the same literal. A
  // parameter list the wildcard reading would not reconstruct (a named
  // parameter, an unused or gapped `_k`) is printed as it is.
  test('Wildcard-parameter literals round-trip through LaTeX', () => {
    const cases: [any, string][] = [
      [
        ['Function', ['Add', '_1', 1]],
        '\\operatorname{\\_1}\\mapsto\\operatorname{\\_1}+1',
      ],
      [
        ['Function', ['Add', '_1', '_2']],
        '(\\operatorname{\\_1}, \\operatorname{\\_2})\\mapsto\\operatorname{\\_1}+\\operatorname{\\_2}',
      ],
      // The `\frac{1}{n}\cdot[0...n]` of ROADMAP CE-417: the literal of the
      // `Map` has the parameter `_1`.
      [
        ['Function', ['Divide', '_1', 'n'], '_1'],
        '\\operatorname{\\_1}\\mapsto\\frac{\\operatorname{\\_1}}{n}',
      ],
      // A `_` that a nested literal uses from the outer literal stays the
      // name of the outer parameter (`anonymousParameters`).
      [
        ['Function', ['Apply', ['Function', ['Add', '_1', '_'], '_1'], 2]],
        '\\operatorname{\\_}\\mapsto(\\operatorname{\\_1}\\mapsto\\operatorname{\\_}+\\operatorname{\\_1})(2)',
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
  // A wildcard that a nested literal binds, through a rest parameter or a
  // destructuring pattern, is not a parameter of the outer literal: the
  // outer literal has the one parameter `_2`, as boxing reads it. (The
  // LaTeX of the nested parameter itself does not round-trip: ROADMAP
  // CE-441.)
  test('A wildcard bound by a nested rest or destructuring parameter', () => {
    for (const inner of [
      ['Function', ['Multiply', '_1', 2], ['Spread', '_1']],
      ['Function', ['Multiply', '_1', 'y'], ['Tuple', '_1', 'y']],
    ]) {
      const f = ce.box(['Function', ['Add', '_2', ['Apply', inner, 3]]]);
      expect((f.json as any[]).slice(2)).toEqual(['_2']);
      expect(f.latex.startsWith('\\operatorname{\\_2}\\mapsto')).toBe(true);
    }
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

// A literal with a tuple pattern, a rest parameter or a default value has no
// `\mapsto` notation that reads back as the same literal (`(x, y)\mapsto xy`
// is a function of two parameters). It is written `\mathrm{Function}(…)` with
// its MathJSON operands, and the parse of that text is the same literal.
describe('Anonymous functions, parameters with no \\mapsto notation', () => {
  const cases: [unknown, string][] = [
    [
      ['Function', ['Multiply', 'x', 'y'], ['Tuple', 'x', 'y']],
      '\\mathrm{Function}(xy, \\mathrm{Tuple}(x, y))',
    ],
    [
      ['Function', ['Add', 'a', 'b', 'c'], ['Tuple', ['Tuple', 'a', 'b'], 'c']],
      '\\mathrm{Function}(a+b+c, \\mathrm{Tuple}(\\mathrm{Tuple}(a, b), c))',
    ],
    [
      ['Function', 'b', ['Tuple', '_', 'b']],
      '\\mathrm{Function}(b, \\mathrm{Tuple}(\\operatorname{\\_}, b))',
    ],
    [
      ['Function', ['Multiply', 2, 'x'], ['Spread', 'x']],
      '\\mathrm{Function}(2x, \\mathrm{Spread}(x))',
    ],
    [
      ['Function', ['Multiply', 'k', 'x'], 'x', ['Optional', 'k', 2]],
      '\\mathrm{Function}(kx, x, \\mathrm{Optional}(k, 2))',
    ],
    [
      ['Function', ['Length', 's'], ['Optional', 's', "'abc'"]],
      '\\mathrm{Function}(\\mathrm{Length}(s), \\mathrm{Optional}(s, \\text{abc}))',
    ],
    // A typed parameter keeps its type, also a type with no `\colon`
    // notation.
    [
      [
        'Function',
        ['Add', 'a', ['Length', 'r']],
        ['Typed', 'a', "'list<integer>'"],
        ['Spread', 'r'],
      ],
      '\\mathrm{Function}(a+\\mathrm{Length}(r), \\mathrm{Typed}(a, \\text{list<integer>}), \\mathrm{Spread}(r))',
    ],
    // A body of several statements is a `Block` with its operands: the fenced
    // form `\left(…; …\right)` would read back as a `Block` in a `Block`.
    [
      [
        'Function',
        ['Block', ['Assign', 'a', 'x'], ['Multiply', 'a', 'y']],
        ['Tuple', 'x', 'y'],
      ],
      '\\mathrm{Function}(\\mathrm{Block}(\\mathrm{Assign}(a, x), ay), \\mathrm{Tuple}(x, y))',
    ],
    // An assigned function value keeps the type of its parameter: the
    // shorthand `g(t)\coloneq t` would drop it.
    [
      [
        'Function',
        [
          'Block',
          ['Assign', 'g', ['Function', 't', ['Typed', 't', "'integer'"]]],
          ['g', 'r'],
        ],
        ['Spread', 'r'],
      ],
      '\\mathrm{Function}(\\mathrm{Block}(\\mathrm{Assign}(g, (t\\colon integer)\\mapsto t), g(r)), \\mathrm{Spread}(r))',
    ],
  ];
  test.each(cases)('%j', (json, latex) => {
    const f = ce.box(json as Parameters<typeof ce.box>[0]);
    expect(f.latex).toBe(latex);
    expect(ce.parse(latex).isSame(f)).toBe(true);
  });

  test('the parsed pair literal applies to a pair', () => {
    const f = ce.box(['Function', ['Multiply', 'x', 'y'], ['Tuple', 'x', 'y']]);
    const g = ce.parse(f.latex);
    expect(ce.box(['Apply', g, ['Tuple', 3, 4]]).evaluate().json).toBe(12);
  });

  test('a literal with plain parameters keeps the \\mapsto notation', () => {
    expect(ce.box(['Function', ['Multiply', 'k', 'x'], 'x', 'k']).latex).toBe(
      '(x, k)\\mapsto kx'
    );
  });
});

describe('Invalid', () => {
  test('Parens around arguments required', () =>
    expect(parse('x, y\\mapsto x + y')).toMatchInlineSnapshot(
      `["Pair", "x", ["Function", ["Add", "x", "y"], "y"]]`
    ));
});
