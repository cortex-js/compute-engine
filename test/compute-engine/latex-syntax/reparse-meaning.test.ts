/**
 * Three serializations and one parse that changed the meaning of an
 * expression on a LaTeX round trip (Tycho ledger rows 387, 388 and 389,
 * filed 2026-10-18 on CE 0.156.0).
 *
 * - 387 (a): `f''(x)(…)` parsed as the value `f''(x)` applied to `(…)`,
 *   while `f(x)(…)` parses as a product. (b): a one-argument `Apply` written
 *   with `\lhd`, which has precedence 20, lost its left factor on re-parse.
 * - 388: a big operator read the factor after it into its body
 *   (`\prod_{i=1}^{10}P_1(i)P_0(r)`), and its body read past the `\\` that
 *   ends a `cases` row, so the `Which` lost every clause.
 * - 389: a nested `Block` was written as a bare `;` list, and the comparison
 *   after it moved inside the block.
 *
 * Rows 390, 393, 394 and 395 (filed 2026-10-18): trees that kept their value
 * but not their shape with `prettify: false`.
 *
 * - 390: a `Range` with a float or symbolic step (`a..b..c` gives the second
 *   element, and the step is read back as `b − a`), and a quotient of
 *   products of a variable named `d`, which read back as a derivative.
 * - 393: a negative machine number with an exponent in its shortest
 *   spelling had its sign written among its digits.
 * - 394: a function literal whose body is one statement was written as a
 *   block.
 * - 395: the operand of `Mod` written as a product with `\times` lost all but
 *   its last factor.
 */
import { ComputeEngine } from '../../../src/compute-engine';

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('f', 'function');
});

/** The LaTeX of `json`, and whether it parses back to the same expression. */
function roundTrip(json: unknown): { latex: string; same: boolean } {
  const e = ce.box(json as any);
  const latex = e.latex;
  return { latex, same: ce.parse(latex).isSame(e) };
}

describe('row 387: a derivative value followed by a parenthesized factor', () => {
  test('parses as a product, as f(x)(…) does', () => {
    expect(ce.parse('-2f^{\\doubleprime}(x)(f(x)-y)').json).toEqual([
      'Multiply',
      -2,
      ['Add', ['Negate', 'y'], ['f', 'x']],
      ['Apply', ['Derivative', 'f', 2], 'x'],
    ]);
    expect(ce.parse("f'(x)(x+1)").json).toEqual([
      'Multiply',
      ['Add', 'x', 1],
      ['Apply', ['Derivative', 'f', 1], 'x'],
    ]);
    // The same through the trig parselet.
    expect(ce.parse("\\sin'(x)(y)").json).toEqual([
      'Multiply',
      'y',
      ['Apply', ['Derivative', 'Sin', 1], 'x'],
    ]);
    // A single application is unchanged.
    expect(ce.parse("f'(2)").json).toEqual([
      'Apply',
      ['Derivative', 'f', 1],
      2,
    ]);
  });

  test('a nested one-argument Apply is written in parentheses', () => {
    const r = roundTrip([
      'Multiply',
      -2,
      [
        'Apply',
        ['Apply', ['Derivative', 'f', 2], 'x'],
        ['Add', ['Negate', 'y'], ['f', 'x']],
      ],
    ]);
    expect(r.latex).toBe('-2(f^{\\doubleprime}(x)\\lhd f(x)-y)');
    expect(r.same).toBe(true);
  });
});

describe('row 388: a big operator and what follows it', () => {
  test('a factor after a product stays outside it', () => {
    const r = roundTrip([
      'Multiply',
      ['Product', ['P_1', 'i'], ['Limits', 'i', 1, 10]],
      ['P_0', 'r'],
    ]);
    expect(r.latex).toBe('(\\prod_{i=1}^{10}P_1(i))P_0(r)');
    expect(r.same).toBe(true);
    // The product alone takes no parentheses.
    expect(
      roundTrip(['Product', ['P_1', 'i'], ['Limits', 'i', 1, 10]])
    ).toEqual({ latex: '\\prod_{i=1}^{10}P_1(i)', same: true });
  });

  test('a limit factor is written in parentheses too', () => {
    // Raw, so that the limit stays the first factor (the canonical order
    // puts `y` first, where no parentheses are needed).
    const json = [
      'Multiply',
      ['Limit', ['Function', ['Sin', 'x'], 'x'], 0],
      'y',
    ];
    const latex = ce.box(json as any, { form: 'raw' } as any).latex;
    expect(latex).toMatch(/^\(\\lim_/);
    expect(ce.parse(latex).isSame(ce.box(json as any))).toBe(true);
  });

  // The body ends at the end of a cell only: the condition of a trig
  // argument (stop at the next trig command) does not reach it.
  test.each([
    [
      '\\sin\\int_0^\\pi\\cos x\\,dx',
      ['Sin', ['Integrate', ['Cos', 'x'], ['Tuple', 'x', 0, 'Pi']]],
    ],
    [
      '\\sin\\sum_{n=1}^{10}\\cos n',
      ['Sin', ['Sum', ['Cos', 'n'], ['Tuple', 'n', 1, 10]]],
    ],
    [
      '\\cos\\lim_{x\\to0}\\sin x',
      ['Cos', ['Limit', ['Function', ['Sin', 'x'], 'x'], 0]],
    ],
    [
      '\\sin\\sum_{i=1}^{3} i !',
      ['Sin', ['Sum', ['Factorial', 'i'], ['Tuple', 'i', 1, 3]]],
    ],
  ])('%s keeps its body inside the trig argument', (latex, json) => {
    expect(ce.parse(latex, { form: 'raw' } as any).json).toEqual(json);
  });

  test('a product in a cases clause keeps every clause', () => {
    const r = roundTrip([
      'Which',
      ['Less', 0, ['Product', ['T', 'i'], ['Limits', 'i', 1, 10]]],
      'j',
      'True',
      100,
    ]);
    expect(r.same).toBe(true);
  });

  test.each([
    ['\\sum_{i=1}^{3}i'],
    ['\\prod_{i=1}^{10}T(i)'],
    ['\\lim_{x\\to0} x'],
    ['\\int_0^1 t'],
  ])('a cases cell that ends with %s keeps the next row', (cell) => {
    const e = ce.parse(`\\begin{cases}j&${cell}\\\\100&\\top\\end{cases}`, {
      form: 'raw',
    } as any);
    expect(e.operator).toBe('Which');
    expect(e.nops).toBe(4);
  });
});

describe('row 389: a nested Block', () => {
  const block = [
    'Block',
    ['Declare', 'z'],
    ['Assign', 'z', ['Add', 'Z', 1]],
    'd',
  ];

  test('a comparison after it stays outside it', () => {
    const r = roundTrip(['Less', block, 1]);
    expect(r.latex).toBe('\\left(z\\coloneq Z+1; d\\right)\\lt1');
    expect(r.same).toBe(true);
    // At the top level a block is written bare.
    expect(roundTrip(block)).toEqual({
      latex: 'z\\coloneq Z+1; d',
      same: true,
    });
  });

  test('a raw round trip through parentheses is stable', () => {
    let e = ce.box(['Less', ['Delimiter', block], 1], { form: 'raw' } as any);
    const first = e.latex;
    for (let k = 0; k < 3; k++) e = ce.parse(e.latex, { form: 'raw' } as any);
    expect(e.latex).toBe(first);
  });

  // The heads that absorbed a nested block (`BLOCK_ABSORBING_HEADS` in Tycho).
  test.each([
    [['Multiply', 'q', block]],
    [['Add', block, 1]],
    [['Negate', block]],
    [['Equal', block, 2]],
    [['NotEqual', block, 2]],
    [['GreaterEqual', block, 2]],
    [['List', block, 3]],
    [['Tuple', block, 3]],
    [['Mod', block, 3]],
    [['Factorial', block]],
    [['And', ['Less', block, 1], 'p']],
    [['Not', ['Less', block, 1]]],
    [['Power', block, 2]],
    [['Function', block, 'x']],
    [['Sum', block, ['Limits', 'i', 1, 5]]],
  ])('%j round-trips', (json) => {
    expect(roundTrip(json).same).toBe(true);
  });
});

describe('row 391: the derivative of a function literal', () => {
  // `D(x ↦ body, x)` is the derivative of the body, and is written the same
  // way as `D(body, x)`. Its canonical form is `D(body, x)`, so the round
  // trip keeps the tree.
  test.each([
    [['D', ['Function', ['Block', ['Add', 'a', 'b']], 'x'], 'x']],
    [['D', ['Function', ['Block', ['Sin', 'x']], 'x'], 'x']],
    [
      [
        'D',
        [
          'Function',
          [
            'Block',
            ['Declare', 'k'],
            ['Assign', 'k', 2],
            ['Multiply', 'k', 'x'],
          ],
          'x',
        ],
        'x',
      ],
    ],
    // A symbol body keeps the function literal: it is the canonical form of
    // `\frac{\mathrm{d}f}{\mathrm{d}x}`.
    [['D', ['Function', ['Block', 'f'], 'x'], 'x']],
  ])('%j round-trips', (json) => {
    const e = ce.box(json as any);
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('the canonical form is the derivative of the body, with the same value', () => {
    const e = ce.box([
      'D',
      ['Function', ['Block', ['Power', 'x', 3]], 'x'],
      'x',
    ]);
    expect(e.json).toEqual(['D', ['Power', 'x', 3], 'x']);
    expect(e.evaluate().json).toEqual(['Multiply', 3, ['Power', 'x', 2]]);
  });

  test('a curried function literal is not unwrapped', () => {
    const e = ce.box([
      'D',
      ['Function', ['Function', ['Multiply', 'x', 't'], 't'], 'x'],
      'x',
    ]);
    expect(e.json[1]).toEqual([
      'Function',
      ['Block', ['Function', ['Block', ['Multiply', 't', 'x']], 't']],
      'x',
    ]);
  });
});

describe('rows 390, 393 and 394: trees that keep the value but not the tree', () => {
  // Tycho serializes with `prettify: false` and compares the parsed tree
  // with the original. These shapes changed the tree; each one is checked
  // with and without `prettify`.
  const shapes: [string, unknown][] = [
    // `a..b..c` gives the second element; the step is read back as `b − a`.
    [
      'a float step that the machine sum rounds',
      ['Range', 0.6, 5, 0.20000000000000007],
    ],
    ['a decimal step', ['Range', 0.1, 1, 0.2]],
    ['an exact step', ['Range', 1, 2, ['Rational', 1, 3]]],
    ['a symbolic step', ['Range', 1, 5, 'h']],
    [
      'a symbolic start and step',
      ['Range', ['Add', ['Divide', 4, 'q'], 1], 5, ['Divide', 8, 'q']],
    ],
    ['a float start and a symbolic step', ['Range', 0.5, 3, 'h']],
    // A quotient of products of a variable named `d` is not a derivative.
    [
      'a product of d over a product of d',
      [
        'Divide',
        [
          'Multiply',
          'd_upright',
          ['Power', ['Add', ['Power', 'x', 2], -1], 'l'],
        ],
        ['Multiply', 'd_upright', 'x'],
      ],
    ],
    ['dy over dx', ['Divide', ['Multiply', 'd', 'y'], ['Multiply', 'd', 'x']]],
    ['d over dx', ['Divide', 'd_upright', ['Multiply', 'd_upright', 'x']]],
    [
      'd² over dx²',
      ['Divide', ['Power', 'd', 2], ['Multiply', 'd', ['Power', 'x', 2]]],
    ],
    ['d over a symbol named dx', ['Divide', ['Multiply', 'd', 'y'], 'dx']],
    ['d over delta', ['Divide', ['Multiply', 'd', 'y'], 'delta']],
    ['dy over d', ['Divide', ['Multiply', 'd', 'y'], 'd_upright']],
    // A machine number above 2^53 is read back as a float.
    ['a start above 2^53', ['Range', 1e21, 2e21, 1]],
    ['an integer start above 2^53', ['Range', 1e17, 2e17, 'h']],
    ['a very small decimal', ['Range', { num: '1e-1000000000' }, 1, 'h']],
    // Row 393: a negative machine number whose shortest spelling has an
    // exponent kept its sign among the digits (`0.000\,00-15`).
    ['a small negative number', -1.5e-7],
    ['a small negative term', ['Add', 'u', 1, -9.5367431640625e-7]],
    // Row 394: a function literal whose body is one statement.
    ['a function literal of a symbol', ['Function', ['Block', 'f'], 'x']],
    [
      'the derivative of a function literal of a symbol',
      ['D', ['Function', ['Block', 'f'], 'x'], 'x'],
    ],
    // A start and a step that are not both exact or both floats.
    ['a float start and an exact step', ['Range', 0.5, 3, 1]],
    ['an exact start and a float step', ['Range', 1, 5, { num: '1.0' }]],
    ['a float start with an integer value', ['Range', { num: '2.0' }, 5, 'h']],
    // A nested block keeps its outer block.
    [
      'the derivative of a function literal of a nested block',
      ['D', ['Function', ['Block', ['Block', 1, 'x']], 'x'], 'x'],
    ],
    // The derivatives themselves still round-trip.
    ['the derivative of an application', ['D', ['D', ['g', 'x'], 'x'], 'x']],
    ['the derivative of a function symbol', ['D', 'g', 'x']],
  ];
  test.each(shapes)('%s', (_, json) => {
    const engine = new ComputeEngine();
    const e = engine.box(json as any);
    for (const prettify of [false, true]) {
      const latex = e.toLatex({ prettify });
      expect([prettify, engine.parse(latex).json]).toEqual([prettify, e.json]);
    }
  });

  test('an explicit product with d is not a differential', () => {
    expect(ce.parse('\\frac{\\mathrm{d}\\cdot y}{\\mathrm{d}x}').operator).toBe(
      'Divide'
    );
    expect(ce.parse('\\frac{\\mathrm{d}y}{\\mathrm{d}\\cdot x}').operator).toBe(
      'Divide'
    );
    expect(ce.parse('\\frac{\\mathrm{d}y}{\\mathrm{d}x}').operator).toBe('D');
    // Only `d` and one letter is a differential name: `\\delta` is not `d`
    // followed by `elta`.
    expect(ce.parse('\\frac{dy}{\\delta}').operator).toBe('Divide');
    expect(ce.parse('\\frac{dy}{\\mathrm{dx}}').operator).toBe('D');
  });
});

describe('row 395: the dividend of Mod written as an explicit product', () => {
  // A structural product with a number after its first factor is written
  // with `\\times`, which binds more loosely than `\\bmod`.
  test.each([
    [['Mod', ['Multiply', 'a', 2], 1]],
    [['Mod', ['Multiply', ['Sin', 'q'], 43758.5453], 1]],
    [['Mod', 'a', ['Multiply', 'b', 2]]],
  ])('%j', (json) => {
    const engine = new ComputeEngine();
    const structural = engine.box(json as any, { form: 'structural' });
    const canonical = engine.box(json as any);
    for (const prettify of [false, true]) {
      const latex = structural.toLatex({ prettify });
      expect([prettify, engine.parse(latex).json]).toEqual([
        prettify,
        canonical.json,
      ]);
    }
  });
});

describe('local and outer assignments in a block', () => {
  // In a block, `k \coloneq v` declares a local `k` (`Declare` then
  // `Assign`). `let k \coloneq v` is the same, and `let` also gives a
  // declaration its type. A bare `Assign`, which changes a `k` outside the
  // block, is written `\mathrm{Assign}(k, v)`.
  test.each([
    [['Block', ['Declare', 'k'], ['Assign', 'k', 2], ['Multiply', 'k', 'x']]],
    [['Block', ['Assign', 'k', 2], ['Multiply', 'k', 'x']]],
    [['Block', ['Assign', 'k', 2]]],
    [
      [
        'Block',
        ['Declare', 's', "'integer'"],
        ['Assign', 's', 1],
        ['Add', 's', 1],
      ],
    ],
    [['Block', ['Declare', 's', "'list<integer>'"], 's']],
    [['Block', ['Declare', 'a'], ['Add', 'a', 1]]],
    [
      [
        'Block',
        ['Declare', 'a'],
        ['Declare', 'b'],
        ['Assign', 'a', 1],
        ['Assign', 'b', 2],
        ['Add', 'a', 'b'],
      ],
    ],
    [
      [
        'Block',
        ['Declare', 'f'],
        ['Assign', 'f', ['Function', ['Power', 'x', 2], 'x']],
        ['f', 3],
      ],
    ],
    // Types with an arrow or a quoted value; a symbol type.
    [['Block', ['Declare', 'f', "'(real) -> real'"], 'f']],
    [['Block', ['Declare', 's', '\'"a,b"\''], 's']],
    [['Block', ['Declare', 'k', 'integer'], 'k']],
    // A function whose body is a block of several statements.
    [
      [
        'Block',
        ['Declare', 'k'],
        [
          'Assign',
          'k',
          [
            'Function',
            ['Block', ['Declare', 'j'], ['Assign', 'j', 'x'], 'j'],
            'x',
          ],
        ],
        ['k', 2],
      ],
    ],
    [['Assign', 'f', ['Function', ['Block', ['Assign', 'k', 'x']], 'x']]],
  ])('%j round-trips', (json) => {
    const engine = new ComputeEngine();
    const e = engine.box(json as any);
    for (const prettify of [false, true]) {
      const latex = e.toLatex({ prettify });
      expect([prettify, engine.parse(latex).json]).toEqual([prettify, e.json]);
    }
  });

  test('let is a local declaration', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\operatorname{let} k\\coloneq 2; kx', { form: 'raw' }).json
    ).toEqual([
      'Block',
      ['Declare', 'k'],
      ['Assign', 'k', 2],
      ['InvisibleOperator', 'k', 'x'],
    ]);
    expect(
      engine.parse('\\text{let }s\\colon integer\\coloneq 1; s', {
        form: 'raw',
      }).json
    ).toEqual([
      'Block',
      ['Declare', 's', "'integer'"],
      ['Assign', 's', 1],
      's',
    ]);
  });

  test('a let in a where clause or a cases block is a local of the block', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 10);
    expect(
      engine
        .parse('k+1 \\text{ where } \\text{let } k \\coloneq 2')
        .evaluate()
        .toString()
    ).toBe('3');
    expect(
      engine.parse(
        '\\begin{cases}\\text{let }k\\coloneq 2\\\\ k+1\\end{cases}',
        { form: 'raw' }
      ).json
    ).toEqual(['Block', ['Declare', 'k'], ['Assign', 'k', 2], ['Add', 'k', 1]]);
  });

  test('the marks survive preserveLatex', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 5);
    engine.parse('0; k\\coloneq2; k', { preserveLatex: true }).evaluate();
    expect(engine.box('k').evaluate().toString()).toBe('5');
  });

  test('a let with no value after the assignment is an error', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\text{let }k\\colon integer\\coloneq', { form: 'raw' })
        .json
    ).toEqual([
      'Block',
      ['Declare', 'k', "'integer'"],
      ['Assign', 'k', ['Error', "'missing'"]],
    ]);
  });

  test('a let with a type that is not one is an error in the block', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\text{let } s\\colon \\mathbb{Z} \\coloneq 1; s', {
        form: 'raw',
      }).json
    ).toEqual([
      'Block',
      ['Declare', 's'],
      ['Error', "'invalid-type'", "'\\mathbb{Z}'"],
      ['Assign', 's', 1],
      's',
    ]);
  });

  test('after let, = is the assignment, as in Epsil', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\text{let } s\\colon integer = 1; s', { form: 'raw' }).json
    ).toEqual([
      'Block',
      ['Declare', 's', "'integer'"],
      ['Assign', 's', 1],
      's',
    ]);
    expect(
      engine.parse('\\text{let } k = 2; k+1', { form: 'raw' }).json
    ).toEqual(['Block', ['Declare', 'k'], ['Assign', 'k', 2], ['Add', 'k', 1]]);
  });

  test('a name is declared once per block', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\text{let } s; s\\coloneq 2; s+1').evaluate().toString()
    ).toBe('3');
    expect(
      engine.parse('x\\coloneq 1; x\\coloneq x+1; x').evaluate().toString()
    ).toBe('2');
  });

  test('a one-column cases block reads its rows as a ; list does', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 10);
    engine.parse('\\begin{cases}k\\coloneq 2\\\\ k+1\\end{cases}').evaluate();
    expect(engine.box('k').evaluate().toString()).toBe('10');
    expect(
      engine.parse(
        '\\begin{cases}x+1\\\\ \\text{let }k\\colon integer\\end{cases}',
        { form: 'raw' }
      ).json
    ).toEqual(['Block', ['Add', 'x', 1], ['Declare', 'k', "'integer'"]]);
  });

  test('a local and an outer assignment', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 5);
    engine.parse('k\\coloneq 2; k').evaluate();
    expect(engine.box('k').evaluate().toString()).toBe('5');
    engine.parse('\\mathrm{Assign}(k, 2); k').evaluate();
    expect(engine.box('k').evaluate().toString()).toBe('2');
  });
});

describe('the outer assignment without an engine', () => {
  test('a standalone LatexSyntax reads the function spelling as a block', async () => {
    const { LatexSyntax } =
      await import('../../../src/compute-engine/latex-syntax/latex-syntax');
    const ls = new LatexSyntax({});
    const latex = ls.serialize(['Block', ['Assign', 's', 2], ['Add', 's', 1]]);
    expect(latex).toBe('\\mathrm{Assign}(s, 2); s+1');
    expect(ls.parse(latex)).toEqual([
      'Block',
      ['Assign', 's', 2],
      ['Add', 's', 1],
    ]);
  });

  test('a standalone LatexSyntax reads the function spelling of Declare', async () => {
    const { LatexSyntax } =
      await import('../../../src/compute-engine/latex-syntax/latex-syntax');
    const ls = new LatexSyntax({});
    const block = [
      'Block',
      ['Declare', 's', 'integer'],
      ['Assign', 's', 1],
      's',
    ];
    expect(ls.parse(ls.serialize(block as any))).toEqual(block);
  });
});
