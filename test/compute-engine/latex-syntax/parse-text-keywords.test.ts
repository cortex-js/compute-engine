import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';
import { LatexSyntax, LATEX_DICTIONARY } from '../../../src/latex-syntax';

describe('DOUBLE-QUOTED STRING LITERALS', () => {
  test('parses a double-quoted string', () => {
    expect(ce.parse('"hello"').string).toBe('hello');
  });

  test('parses an empty string', () => {
    expect(ce.parse('""').string).toBe('');
  });

  test('preserves spaces', () => {
    expect(ce.parse('"a b c"').string).toBe('a b c');
  });

  test('normalizes commands to Unicode, like \\text', () => {
    expect(ce.parse('"\\alpha"').string).toBe('α');
  });

  test('serializes back to \\text{…} (no round-trip to quotes)', () => {
    expect(ce.parse('"hello"').latex).toBe('\\text{hello}');
  });

  test('does not interfere with \\unicode hex prefix', () => {
    // The `"` inside `\unicode{…}` is a hex prefix on a separate parse path.
    expect(ce.parse('\\unicode{"2012}').json).toEqual('____002012');
  });

  test('an unterminated string is an error', () => {
    expect(ce.parse('"abc').operator).toBe('Error');
  });

  test('reads a dictionary value by key via bracket notation', () => {
    const engine = new ComputeEngine();
    const dict = engine.box({ dict: { height: 42, width: 7 } });
    engine.declare('tbl', dict.type);
    engine.assign('tbl', dict);
    expect(engine.parse('\\mathrm{tbl}["height"]').evaluate().valueOf()).toBe(
      42
    );
  });
});

describe('TEXT KEYWORDS', () => {
  test('\\text{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\text{ and } x < 10').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Less,
          0,
          x,
        ],
        [
          Less,
          x,
          10,
        ],
      ]
    `);
  });

  test('\\text{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\text{ or } x = 1').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          x,
          0,
        ],
        [
          Equal,
          x,
          1,
        ],
      ]
    `);
  });

  test('\\text{iff} as biconditional', () => {
    expect(ce.parse('P \\text{ iff } Q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });

  test('\\text{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{andy}').json).toMatchInlineSnapshot(`'andy'`);
  });

  test('\\text{organic} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{organic}').json).toMatchInlineSnapshot(`'organic'`);
  });

  test('\\text{if and only if} as biconditional', () => {
    expect(ce.parse('P \\text{ if and only if } Q').json)
      .toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });
});

describe('KEYWORD COMMAND (\\keyword{…})', () => {
  test('\\keyword{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\keyword{and} x < 10').json).toEqual([
      'And',
      ['Less', 0, 'x'],
      ['Less', 'x', 10],
    ]);
  });

  test('\\keyword{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\keyword{or} x = 1').json).toEqual([
      'Or',
      ['Equal', 'x', 0],
      ['Equal', 'x', 1],
    ]);
  });

  test('\\keyword{iff} as biconditional', () => {
    expect(ce.parse('P \\keyword{iff} Q').json).toEqual([
      'Equivalent',
      'P',
      'Q',
    ]);
  });

  test('\\keyword{if and only if} (multi-word, one token)', () => {
    expect(ce.parse('P \\keyword{if and only if} Q').json).toEqual([
      'Equivalent',
      'P',
      'Q',
    ]);
  });

  test('\\keyword{for all} quantifier', () => {
    // The quantifier body is canonical (`Greater` folds to `Less`).
    expect(ce.parse('\\keyword{for all} x, x > 0').json).toEqual([
      'ForAll',
      'x',
      ['Less', 0, 'x'],
    ]);
  });

  test('\\keyword{where} binding', () => {
    expect(ce.parse('x \\keyword{where} x = 2').json).toEqual([
      'Block',
      ['Equal', 'x', 2],
      'x',
    ]);
  });

  test('mixed \\keyword and \\text spellings interoperate', () => {
    expect(
      ce.parse('x > 0 \\keyword{and} x < 10 \\text{ or } x = -1').json
    ).toEqual(ce.parse('x > 0 \\text{ and } x < 10 \\text{ or } x = -1').json);
  });

  test('\\keyword{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\keyword{andy}').json).toMatchInlineSnapshot(`'andy'`);
  });
});

describe('TRAILING QUALIFIER CLAUSES', () => {
  test('trailing \\text{for} condition parses as ForAll', () => {
    // A non-binding clause (a condition, not `name = collection`) after `for`
    // is a trailing qualifier: `body for n >= 2` → ForAll(n >= 2, body).
    // Both operands are canonical — the quantifiers canonicalize their held
    // operands, so the condition folds to `LessEqual` and the body's
    // `InvisibleOperator` resolves to `Multiply`.
    const engine = new ComputeEngine();
    expect(engine.parse('u_n = 3u_{n-1} \\text{ for } n \\ge 2').json).toEqual([
      'ForAll',
      ['LessEqual', 2, 'n'],
      [
        'Equal',
        'u_n',
        ['Multiply', 3, ['Subscript', 'u', ['Subtract', 'n', 1]]],
      ],
    ]);
  });

  test('trailing \\text{for all} condition parses as ForAll', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('u_n = 3u_{n-1} \\text{ for all } n \\ge 2').json
    ).toEqual([
      'ForAll',
      ['LessEqual', 2, 'n'],
      [
        'Equal',
        'u_n',
        ['Multiply', 3, ['Subscript', 'u', ['Subtract', 'n', 1]]],
      ],
    ]);
  });

  test('trailing \\text{for} with a comprehension binding still parses as Comprehension', () => {
    // Regression guard: a `name = collection` clause is a comprehension, not a
    // trailing condition.
    const engine = new ComputeEngine();
    expect(engine.parse('x^2 \\text{ for } x = 1..10').json).toEqual([
      'Comprehension',
      ['Power', 'x', 2],
      ['Element', 'x', ['Range', 1, 10]],
    ]);
  });

  test('a non-condition clause after \\text{for} is not swallowed', () => {
    // `for y` (neither a binding nor a predicate) is not a ForAll: `for` is
    // read as text, as `\keyword{for}` and `\text{ for all }` are.
    const engine = new ComputeEngine();
    expect(engine.parse('x^2 \\text{ for } y', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      ['Power', 'x', 2],
      "' for '",
      'y',
    ]);
  });

  test('English enumeration `and` after a comma is absorbed', () => {
    // `a, b, and c` is a list `a, b, c`, not a stray `and` text token.
    const engine = new ComputeEngine();
    expect(engine.parse('a, b, \\text{and } c').json).toEqual([
      'Tuple',
      'a',
      'b',
      'c',
    ]);
  });

  test('recurrence system: u_0, u_1, u_n = ... for n >= 2', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'u_0 = 0,\\ u_1 = 1,\\ u_n = 2011u_{n-1} - u_{n-2} \\quad \\text{for } n \\ge 2.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['LessEqual', 2, 'n']);
    // The body is a Tuple of the three equations.
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });

  test('recurrence system with fraction: x_1, x_2, x_n = ... for n >= 3', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'x_1 = a, \\quad x_2 = b, \\quad x_n = \\frac{x_{n-1}^2 + x_{n-2}^2}{x_{n-1} + x_{n-2}} \\quad \\text{for } n \\ge 3.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['LessEqual', 3, 'n']);
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });

  test('recurrence system with enumeration `and` and trailing `for all`', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'a_0 = 1, \\quad a_1 = 3, \\quad \\text{and} \\quad a_{n+1} = a_n + a_{n-1} \\quad \\text{for all } n \\ge 1.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    // The `and` connective is absorbed, so there is no stray text token.
    expect(JSON.stringify(e.json)).not.toContain("'and'");
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['LessEqual', 1, 'n']);
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });
});

describe('A KEYWORD THAT DOES NOT APPLY IS TEXT', () => {
  // `where`, `for` and `if` are also read by the `\operatorname{…}` keyword
  // entries. When the keyword does not apply (nothing after `where`), the
  // words are a text run, as for a word that is not a keyword.
  const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;

  test.each([
    ['x \\text{where}', ['InvisibleOperator', 'x', "'where'"]],
    ['x \\text{ where }', ['InvisibleOperator', 'x', "' where '"]],
    ['x \\keyword{where}', ['InvisibleOperator', 'x', "'where'"]],
    ['x \\text{for}', ['InvisibleOperator', 'x', "'for'"]],
    ['x \\text{for} y', ['InvisibleOperator', 'x', "'for'", 'y']],
    ['x \\text{if}', ['InvisibleOperator', 'x', "'if'"]],
    ['x \\text{let}', ['InvisibleOperator', 'x', "'let'"]],
  ])('%s', (latex, expected) => {
    expect(raw(latex)).toEqual(expected);
  });

  test('\\operatorname{where} that does not apply is a symbol', () => {
    expect(raw('x \\operatorname{where}')).toEqual([
      'InvisibleOperator',
      'x',
      'where',
    ]);
    expect(raw('x \\mathrm{for}')).toEqual(['InvisibleOperator', 'x', 'for']);
  });

  test('a style switch before the keyword is kept', () => {
    expect(raw('x \\large \\text{where}')).toEqual([
      'InvisibleOperator',
      'x',
      ['Annotated', "'where'", { dict: { size: 6 } }],
    ]);
  });

  test('a keyword that applies is still read', () => {
    expect(raw('x+1 \\text{ where } x \\coloneq 2')).toEqual([
      'Block',
      ['Declare', 'x'],
      ['Assign', 'x', 2],
      ['Add', 'x', 1],
    ]);
    expect(raw('x \\operatorname{where} x \\coloneq 2')).toEqual([
      'Block',
      ['Declare', 'x'],
      ['Assign', 'x', 2],
      'x',
    ]);
    expect(raw('x^2 \\text{ for } x \\ge 0')).toEqual([
      'ForAll',
      ['GreaterEqual', 'x', 0],
      ['Power', 'x', 2],
    ]);
  });
});

describe('A KEYWORD OPERATOR WITH NO RIGHT OPERAND', () => {
  // The right operand is a `missing` error, as for `x \lor`, not `Nothing`,
  // which canonicalization drops (`x \text{and}` was `And(x)`).
  const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;

  test.each([
    ['x \\text{and}', 'And'],
    ['x \\text{or}', 'Or'],
    ['x \\text{iff}', 'Equivalent'],
    ['x \\text{if and only if}', 'Equivalent'],
    ['x \\text{such that}', 'Colon'],
  ])('%s', (latex, op) => {
    expect(raw(latex)).toEqual([op, 'x', ['Error', "'missing'"]]);
  });
});

describe('A KEYWORD AFTER AN OPERAND', () => {
  const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;

  test.each([
    // A statement keyword that applies starts another expression, for the
    // `\text` and the `\operatorname` spellings.
    ['x \\text{return} y', ['Sequence', 'x', ['Return', 'y']]],
    [
      'x \\operatorname{return} x = 2',
      ['Sequence', 'x', ['Return', ['Equal', 'x', 2]]],
    ],
    ['x \\text{let} y', ['Sequence', 'x', ['Block', ['Declare', 'y']]]],
    [
      'x \\text{ if } a \\text{ then } b \\text{ else } c',
      ['Sequence', 'x', ['If', 'a', 'b', 'c']],
    ],
    // A keyword that does not apply is text, also in a group.
    ['\\{x \\text{where}\\}', ['Set', ['InvisibleOperator', 'x', "'where'"]]],
    [
      '(x \\text{ for }) + 1',
      ['Add', ['Delimiter', ['InvisibleOperator', 'x', "' for '"]], 1],
    ],
    [
      '\\frac{x \\text{ where }}{2}',
      ['Divide', ['InvisibleOperator', 'x', "' where '"], 2],
    ],
    // The input after a statement is read too.
    [
      'a \\text{return} b \\text{return} c',
      ['Sequence', 'a', ['Return', 'b'], ['Return', 'c']],
    ],
    ['x \\text{break} y', ['Sequence', 'x', ['Break'], 'y']],
    // Also after a symbol prefix operator that ends an operand.
    ['x \\neg y \\neg z', ['Sequence', 'x', ['Not', 'y'], ['Not', 'z']]],
    [
      'x \\lnot y )',
      [
        'Sequence',
        'x',
        ['Not', 'y'],
        ['Error', "'unexpected-delimiter'", ['LatexString', "')'"]],
      ],
    ],
  ])('%s', (latex, expected) => {
    expect(raw(latex)).toEqual(expected);
  });

  // `\text{for}` is read by the `\text` entry and by the `\operatorname{for}`
  // entry. Each entry parsed the rest of the input, so each `for` that does
  // not apply doubled the time of the parse.
  test.each([
    [
      'for',
      Array.from({ length: 40 }, (_, i) => `x_{${i}} \\text{ for } y_{${i}}`),
    ],
    [
      'if',
      Array.from({ length: 40 }, (_, i) => `x_{${i}} \\text{ if } y_{${i}}`),
    ],
    ['where', Array.from({ length: 40 }, (_, i) => `x_{${i}} \\text{ where }`)],
    // The inner keyword is ahead, so each `if` and `for` parses its first
    // operand before it declines.
    [
      'if … then',
      [
        ...Array.from({ length: 40 }, (_, i) => `x_{${i}} \\text{if}`),
        '\\text{then} 1 \\text{else} 2',
      ],
    ],
    [
      'for … from',
      [
        ...Array.from({ length: 20 }, (_, i) => `x_{${i}} \\text{for}`),
        '\\text{from} 1 \\text{to} 2 \\text{do} 3',
      ],
    ],
  ])('a chain of `%s` clauses parses in polynomial time', (_, terms) => {
    const start = Date.now();
    ce.parse(terms.join(' '), { form: 'raw' });
    // The parse runs in every test run, so an exponential case fails on the
    // jest time limit; the wall-clock bound is checked only in a perf run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });

  // A quantifier makes a new terminator at each call, so its results do not
  // occur again. The parser keeps a bounded number of them: before, this
  // input filled a `Map` until `ce.parse()` threw a `RangeError`. The parse
  // is still slow (see ROADMAP.md, "A chain of `for all` or `there exists`
  // clauses parses in exponential time"), so the chain is short.
  test('a chain of `for all` clauses does not throw', () => {
    const latex = Array.from({ length: 8 }, (_, i) => `x_{${i}}`).join(
      ' \\text{for all} '
    );
    expect(() => ce.parse(latex, { form: 'raw' })).not.toThrow();
  });
});

describe('A CUSTOM \\text ENTRY THAT DECLINES', () => {
  // The custom entries read the braced group, then decline. The keyword
  // entries after them are still compared with the group at the start.
  test('the keyword entries after it still match', () => {
    const syntax = new LatexSyntax({ dictionary: [...LATEX_DICTIONARY] });
    const decline = (parser: { parseStringGroup: () => unknown }) => {
      parser.parseStringGroup();
      return null;
    };
    syntax.addEntries([
      {
        kind: 'infix',
        latexTrigger: ['\\text'],
        precedence: 300,
        parse: decline,
      },
      {
        kind: 'prefix',
        latexTrigger: ['\\text'],
        precedence: 300,
        parse: decline,
      },
    ]);
    expect(syntax.parse('P \\text{and} Q')).toEqual(['And', 'P', 'Q']);
    expect(syntax.parse('\\text{let} y \\coloneq 2')).toEqual([
      'Block',
      ['Declare', 'y'],
      ['Assign', 'y', 2],
    ]);
  });
});
