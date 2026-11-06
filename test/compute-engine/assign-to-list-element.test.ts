import { ComputeEngine, compile } from '../../src/compute-engine';

const CODE = 'assignment-to-list-element';

/** An engine with the list `L`, the matrix `M`, the list `n` and `k = 2`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 10, 20, 30]));
  ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
  ce.assign('n', ce.box(['List', 1, 2, 3]));
  ce.assign('k', 2);
  return ce;
}

/** The library function `At` still reads an element of a list. */
function expectElementReadsUnchanged(ce: ComputeEngine): void {
  expect(ce.box(['At', ['List', 7, 8], 2]).evaluate().json).toBe(8);
  expect(ce.box(['At', ['List', 7, 8, 9], 'k']).evaluate().json).toBe(8);
}

function valueOf(ce: ComputeEngine, name: string): unknown {
  return ce.box(name).evaluate().json;
}

describe('an assignment to a list element rebinds the list', () => {
  // `L[k] \coloneq v` is `Assign(L, ReplaceAt(L, k, v))`. Read as
  // `head(args) := value`, each of these forms defined a function named `At`
  // before CE-823, which replaced the library function for the whole engine.
  test.each([
    ['a symbol index', 'L[k]\\coloneq 5', [10, 5, 30]],
    ['a symbol index, spelled :=', 'L[k]:=5', [10, 5, 30]],
    ['a number index', 'L[2]\\coloneq 5', [10, 5, 30]],
    ['a sum index', 'L[k+1]\\coloneq 5', [10, 20, 5]],
    ['a negative index', 'L[-1]\\coloneq 5', [10, 20, 5]],
    ['the function spelling', '\\operatorname{At}(L, k)\\coloneq 5', [10, 5, 30]],
    [
      'the function spelling, a number index',
      '\\operatorname{At}(L, 2)\\coloneq 5',
      [10, 5, 30],
    ],
    ['the upright spelling', '\\mathrm{At}(L, k)\\coloneq 5', [10, 5, 30]],
    [
      'a space before the parenthesis',
      '\\operatorname{At} (L, k)\\coloneq 5',
      [10, 5, 30],
    ],
    ['the upright spelling, a space', '\\mathrm{At} (L, k)\\coloneq 5', [10, 5, 30]],
    [
      'sized parentheses',
      '\\operatorname{At} \\left(L, k\\right)\\coloneq 5',
      [10, 5, 30],
    ],
    [
      'a group around the parentheses',
      '\\operatorname{At}{(L, k)}\\coloneq 5',
      [10, 5, 30],
    ],
    ['the first statement of a sequence', 'L[k]\\coloneq 5; L[2]', [10, 5, 30]],
    [
      'a space, in a sequence',
      '\\operatorname{At} (L, k)\\coloneq 5; L[2]',
      [10, 5, 30],
    ],
    [
      'a row of a cases block',
      '\\begin{cases} L[k]\\coloneq 5 \\\\ L[2]\\end{cases}',
      [10, 5, 30],
    ],
    ['the row of a cases', '\\begin{cases} L[k]\\coloneq 5\\end{cases}', [10, 5, 30]],
  ])('%s', (_name, latex, list) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(JSON.stringify(expr.json)).toContain('["Assign","L",["ReplaceAt","L"');
    expect(JSON.stringify(expr.json)).not.toContain(CODE);
    expr.evaluate();
    expect(valueOf(ce, 'L')).toEqual(['List', ...list]);
    expectElementReadsUnchanged(ce);
  });

  test('the parsed form and the canonical form', () => {
    const ce = engine();
    expect(ce.parse('L[k+1]\\coloneq 5', { form: 'raw' }).json).toEqual([
      'Assign',
      'L',
      ['ReplaceAt', 'L', ['Add', 'k', 1], 5],
    ]);
    expect(ce.parse('L[k+1]\\coloneq 5').json).toEqual([
      'Assign',
      'L',
      ['ReplaceAt', 'L', ['Add', 'k', 1], 5],
    ]);
    expect(ce.parse('L[2]\\coloneq 5').evaluate().json).toEqual([
      'List',
      10,
      5,
      30,
    ]);
  });

  test.each([
    ['two indexes', 'M[2, 1]\\coloneq 9'],
    ['two brackets', 'M[2][1]\\coloneq 9'],
    ['the function spelling', '\\operatorname{At}(M, 2, 1)\\coloneq 9'],
  ])('a matrix element: %s', (_name, latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.json).toEqual(['Assign', 'M', ['ReplaceAt', 'M', 2, 1, 9]]);
    expr.evaluate();
    expect(valueOf(ce, 'M')).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 9, 4],
    ]);
  });

  test.each([
    [
      'a block',
      'n_{1}\\coloneq [10, 20]; n_{1}[1]\\coloneq 9; n_{1}',
    ],
    [
      'a cases block',
      '\\begin{cases} n_{1}\\coloneq [10, 20] \\\\ n_{1}[1]\\coloneq 9 \\\\ n_{1}\\end{cases}',
    ],
  ])(
    'an element of a local spelled as a subscript changes the local: %s',
    (_name, latex) => {
      // `n_{1}` is the local `n_1` of the block (Tycho row 410), so the write
      // goes to `n_1`, and the matrix `n` is unchanged.
      const ce = engine();
      ce.assign('n', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
      const expr = ce.parse(latex);
      expect(JSON.stringify(expr.json)).toContain(
        '["Assign","n_1",["ReplaceAt","n_1",1,9]]'
      );
      expect(expr.evaluate().json).toEqual(['List', 9, 20]);
      expect(valueOf(ce, 'n')).toEqual([
        'List',
        ['List', 1, 2],
        ['List', 3, 4],
      ]);
    }
  );

  test('lists have value semantics: another variable keeps the old list', () => {
    const ce = engine();
    ce.parse('A\\coloneq L').evaluate();
    ce.parse('L[1]\\coloneq 5').evaluate();
    expect(valueOf(ce, 'A')).toEqual(['List', 10, 20, 30]);
    expect(valueOf(ce, 'L')).toEqual(['List', 5, 20, 30]);

    // In a block, `A` is a local and `L` is the variable of the engine.
    const ce2 = engine();
    expect(
      ce2.parse('A\\coloneq L; L[1]\\coloneq 5; A').evaluate().json
    ).toEqual(['List', 10, 20, 30]);
    expect(valueOf(ce2, 'L')).toEqual(['List', 5, 20, 30]);
  });

  test('in a block, the assignment changes the local list', () => {
    // An assignment to an element does not declare a local: it changes the
    // list in scope, here the local `L` of the block.
    const ce = engine();
    const expr = ce.parse(
      'L\\coloneq [1, 2, 3]; j\\coloneq 2; L[j]\\coloneq 5; L'
    );
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'L', "'unknown'", ['List', 1, 2, 3]],
      ['Declare', 'j', "'unknown'", 2],
      ['Assign', 'L', ['ReplaceAt', 'L', 'j', 5]],
      'L',
    ]);
    expect(expr.evaluate().json).toEqual(['List', 1, 5, 3]);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);

    const space = ce.parse(
      'L\\coloneq [10, 20, 30]; \\operatorname{At} (L, 2)\\coloneq 5; L[2]'
    );
    expect(space.evaluate().json).toBe(5);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
  });

  test('a symbolic position keeps the unevaluated form', () => {
    // As `ReplaceAt` documents: with `j` unknown, the write stays
    // `ReplaceAt(L, j, 5)`, and `L` holds it.
    const ce = engine();
    expect(ce.parse('L[j]\\coloneq 5').evaluate().json).toEqual([
      'ReplaceAt',
      ['List', 10, 20, 30],
      'j',
      5,
    ]);
    expect(valueOf(ce, 'L')).toEqual([
      'ReplaceAt',
      ['List', 10, 20, 30],
      'j',
      5,
    ]);
  });

  test('the compilation of the block gives the new element', () => {
    const ce = engine();
    const expr = ce.parse(
      'L\\coloneq [10, 20, 30]; j\\coloneq 2; L[j]\\coloneq 5; L[2]'
    );
    const result = compile(expr, { fallback: false } as any) as any;
    expect(result.success).toBe(true);
    expect(result.run()).toBe(5);
    expect(expr.evaluate().json).toBe(5);
  });
});

describe('an assignment to a list element that is still an error', () => {
  test.each([
    // A `let` statement and a `where` item declare a new local `L`, which
    // `ReplaceAt(L, k, v)` would read before it has a value.
    ['a let statement', '\\operatorname{let} L[k]\\coloneq 5'],
    ['a let statement in a block', '\\operatorname{let} L[k]\\coloneq 5; L[2]'],
    ['a let statement with =', '\\operatorname{let} L[k]=5'],
    ['a let statement with =, in a block', '\\operatorname{let} L[k]=5; L[2]'],
    ['a space, in a let', '\\operatorname{let} \\operatorname{At} (L, k)\\coloneq 5'],
    ['a where item', 'x+1 \\text{ where } L[k]\\coloneq 5'],
    ['a second where item', 'x+a \\text{ where } a\\coloneq 1, L[k]\\coloneq 5'],
    ['a let item of a where', 'x+1 \\text{ where } \\operatorname{let} L[k]\\coloneq 5'],
    ['a space, in a where', 'x+1 \\text{ where } \\operatorname{At} (L, k)\\coloneq 5'],
  ])('%s', (_name, latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(JSON.stringify(expr.json)).toContain('ReplaceAt');
    expect(JSON.stringify(expr.json)).not.toContain('expected-a-symbol');

    expect(JSON.stringify(expr.evaluate().json)).toContain(CODE);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
    expectElementReadsUnchanged(ce);
  });

  test('the error spans the whole assignment, and is one error', () => {
    const ce = engine();
    expect(
      ce.parse('\\operatorname{let} L[k+1]\\coloneq 5', { form: 'raw' }).json
    ).toEqual([
      'Error',
      ['ErrorCode', `'${CODE}'`, "'ReplaceAt'"],
      ['LatexString', "'L[k+1]\\coloneq5'"],
    ]);
  });

  test.each([
    ['a string index', 'd["x"]\\coloneq 5'],
    ['a text index', 'd[\\text{x}]\\coloneq 5'],
    ['a string index, a space', '\\operatorname{At} (d, "x")\\coloneq 5'],
    ['a string index, a let with =', '\\operatorname{let} d["x"]=5'],
  ])('%s has no ReplaceAt detail', (_name, latex) => {
    // `ReplaceAt` refuses a string index, so the error does not suggest it.
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(JSON.stringify(expr.json)).not.toContain('ReplaceAt');
    const replace = ce.box(['ReplaceAt', 'L', { str: 'x' }, 5]);
    expect(JSON.stringify(replace.json)).toContain('incompatible-type');
    expectElementReadsUnchanged(ce);
  });

  test.each([
    ['the value of an assignment', 'a\\coloneq L[k]\\coloneq 5'],
    ['a value that is an assignment', 'L[k]\\coloneq a\\coloneq 5'],
  ])('a chained assignment: %s', (_name, latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('chained-assignment');
    expr.evaluate();
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
  });

  test('a function of the library as the list', () => {
    // The rebinding would replace the function `N`.
    const ce = engine();
    const expr = ce.parse('N[1]\\coloneq 5', { form: 'raw' });
    expect(expr.json).toEqual([
      'Error',
      ['ErrorCode', "'assignment-to-library-function'", "'N'"],
      ['LatexString', "'N[1]\\coloneq5'"],
    ]);
    ce.parse('N[1]\\coloneq 5').evaluate();
    expect(ce.parse('N(1/4)').evaluate().json).toBe(0.25);
  });

  test('a constant of the library as the list', () => {
    const ce = engine();
    const expr = ce.parse('\\pi[1]\\coloneq 5');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.evaluate().json)).toContain('incompatible-type');
    expect(ce.box('Pi').N().re).toBeCloseTo(Math.PI, 12);
  });

  test('a target with no value keeps its error', () => {
    const ce = engine();
    expect(ce.parse('L[k]\\coloneq').isValid).toBe(false);
    expect(JSON.stringify(ce.parse('L[k]\\coloneq').json)).toContain(
      'unexpected-operator'
    );
  });

  test('the MathJSON form keeps its own error', () => {
    const ce = engine();
    const expr = ce.box(['Assign', ['At', 'L', 2], 5]);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('incompatible-type');
    expectElementReadsUnchanged(ce);
  });

  test('the function spelling of Assign keeps its own error', () => {
    const ce = engine();
    const expr = ce.parse('\\mathrm{Assign}(L[k], 5)');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('incompatible-type');
    expectElementReadsUnchanged(ce);
  });
});

describe('a write that does not give a list is an error, and the variable keeps its value', () => {
  /** An engine with `L`, `M`, `n`, `k = 2`, a string, a tuple and a number. */
  function values(): ComputeEngine {
    const ce = engine();
    ce.assign('s', ce.box({ str: 'abc' }));
    ce.assign('t', ce.box(['Tuple', 1, 2]));
    ce.assign('x', 5);
    return ce;
  }

  test.each([
    ['a position past the end', 'L[5]\\coloneq 1', 'L', "'5'"],
    ['a negative position past the start', 'L[-4]\\coloneq 1', 'L', "'-4'"],
    ['the position zero', 'L[0]\\coloneq 1', 'L', "'0'"],
    ['a row past the end', 'M[3][1]\\coloneq 9', 'M', "'3'"],
    ['a column past the end', 'M[1, 3]\\coloneq 9', 'M', "'3'"],
    ['a position read from a variable', 'L[k+5]\\coloneq 1', 'L', "'7'"],
  ])('%s is out-of-range', (_name, latex, name, position) => {
    const ce = values();
    const before = valueOf(ce, name);
    const result = ce.parse(latex).evaluate();
    expect(result.json).toEqual([
      'Error',
      [
        'ErrorCode',
        "'out-of-range'",
        name === 'L' ? "'an index in 1..3 or -3..-1'" : "'an index in 1..2 or -2..-1'",
        position,
      ],
    ]);
    expect(valueOf(ce, name)).toEqual(before);
  });

  test.each([
    [
      'a string',
      's[1]\\coloneq "z"',
      's',
      ['List', "'z'", ['CharacterFrom', "'b'"], ['CharacterFrom', "'c'"]],
    ],
    ['a tuple', 't[1]\\coloneq 5', 't', ['List', 5, 2]],
  ])('%s gives the list that ReplaceAt gives', (_name, latex, name, list) => {
    // The rebinding follows `ReplaceAt`: a string or a tuple gives a list.
    const ce = values();
    expect(ce.parse(latex).evaluate().json).toEqual(list);
    expect(valueOf(ce, name)).toEqual(list);
  });

  test('a string position past its last character is out-of-range', () => {
    // The length of a string is its number of characters.
    const ce = values();
    ce.assign('w', ce.box({ str: 'é👍🏽x' }));
    expect(ce.parse('w[4]\\coloneq "z"').evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'out-of-range'", "'an index in 1..3 or -3..-1'", "'4'"],
    ]);
    expect(valueOf(ce, 'w')).toBe("'é👍🏽x'");
  });

  test.each([
    // `ReplaceAt` gives the error for a number, and for a number at an inner
    // level; a variable with no value leaves it unevaluated, which the
    // assignment refuses.
    ['a number', 'x[1]\\coloneq 5', 'x', 'incompatible-type'],
    ['a variable with no value', 'Q[1]\\coloneq 5', 'Q', CODE],
    [
      'a flat list with two positions',
      'L[1, 1]\\coloneq 5',
      'L',
      'incompatible-type',
    ],
  ])('%s is an error', (_name, latex, name, code) => {
    const ce = values();
    const before = valueOf(ce, name);
    const result = ce.parse(latex).evaluate();
    expect(JSON.stringify(result.json)).toContain(`'${code}'`);
    expect(valueOf(ce, name)).toEqual(before);
  });

  test('in a block, the error is the value of the block', () => {
    const ce = values();
    const expr = ce.parse('P\\coloneq [1, 2, 3]; P[9]\\coloneq 5; P');
    expect(JSON.stringify(expr.evaluate().json)).toContain("'out-of-range'");
  });

  const OUT_OF_RANGE = "'out-of-range'";

  test('a rebinding written in MathJSON is checked too', () => {
    // `Assign(L, ReplaceAt(L, …))` is the same rebinding, parsed or not.
    const ce = values();
    const expr = ce.box(['Assign', 'L', ['ReplaceAt', 'L', 99, 1]]);
    expect(JSON.stringify(expr.evaluate().json)).toContain(OUT_OF_RANGE);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
    // A chain of writes rooted at `L`, as a swap writes it.
    const chain = ce.box([
      'Assign',
      'L',
      ['ReplaceAt', ['ReplaceAt', 'L', 1, 0], 9, 0],
    ]);
    expect(JSON.stringify(chain.evaluate().json)).toContain(OUT_OF_RANGE);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
  });

  test('a ReplaceAt that is not a rebinding keeps its documented result', () => {
    const ce = values();
    const unevaluated = ['ReplaceAt', ['List', 10, 20, 30], 5, 1];
    expect(ce.box(['ReplaceAt', 'L', 5, 1]).evaluate().json).toEqual(
      unevaluated
    );
    expect(
      ce.box(['Assign', 'y', ['ReplaceAt', 'L', 5, 1]]).evaluate().json
    ).toEqual(unevaluated);
    expect(valueOf(ce, 'y')).toEqual(unevaluated);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
  });

  test.each([
    [
      'after subs',
      (ce: ComputeEngine) =>
        ce.parse('L[j]\\coloneq 1').subs({ j: 5 }).evaluate(),
    ],
    [
      'on the structural form',
      (ce: ComputeEngine) => ce.parse('L[5]\\coloneq 1').structural.evaluate(),
    ],
    [
      'after a round trip through the canonical MathJSON',
      (ce: ComputeEngine) =>
        ce.box(ce.parse('L[5]\\coloneq 1').json as never).evaluate(),
    ],
  ])('the check holds %s', (_name, run) => {
    const ce = values();
    expect(JSON.stringify(run(ce).json)).toContain(OUT_OF_RANGE);
    expect(valueOf(ce, 'L')).toEqual(['List', 10, 20, 30]);
  });

  test('a block saved as canonical MathJSON keeps the check', () => {
    const ce = values();
    const json = ce.parse('P\\coloneq [1, 2]; P[5]\\coloneq 1; P').json;
    expect(JSON.stringify(ce.box(json as never).evaluate().json)).toContain(
      OUT_OF_RANGE
    );
  });

  test('a list of more than 100 elements', () => {
    // `ReplaceAt` of a long list gives a lazy view of the new list, which is
    // a list.
    const ce = values();
    const n = 101;
    ce.assign(
      'B',
      ce.box(['List', ...Array.from({ length: n }, (_, i) => i + 1)] as never)
    );
    const first = ce.parse('B[1]\\coloneq 9').evaluate();
    expect(first.isValid).toBe(true);
    expect(ce.box('B').evaluate().at(1)?.json).toBe(9);
    // A second write reads the lazy view as a list.
    ce.parse('B[101]\\coloneq 7').evaluate();
    expect(ce.box('B').evaluate().at(101)?.json).toBe(7);
    expect(ce.box('B').evaluate().at(1)?.json).toBe(9);
    expect(
      JSON.stringify(ce.parse('B[102]\\coloneq 7').evaluate().json)
    ).toContain(OUT_OF_RANGE);
  });

  test('a chain is checked against the value of its inner write', () => {
    // The inner `ReplaceAt` makes the first row `[1, 2]`, so the outer write
    // at position 2 of that row is valid.
    const ce = values();
    ce.assign('R', ce.box(['List', ['List', 1]]));
    const expr = ce.box([
      'Assign',
      'R',
      ['ReplaceAt', ['ReplaceAt', 'R', 1, ['List', 1, 2]], 1, 2, 9],
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['List', 1, 9]]);
    expect(valueOf(ce, 'R')).toEqual(['List', ['List', 1, 9]]);
  });

  test('a finite lazy collection whose count is not known', () => {
    // `FlatMap` gives a lazy collection: `ReplaceAt` reads it, and the
    // write is stored.
    const ce = values();
    ce.assign(
      'F',
      ce.box(['FlatMap', ['List', 1, 2], ['Function', ['List', 'x', 'x'], 'x']])
    );
    expect(ce.parse('F[3]\\coloneq 9').evaluate().json).toEqual([
      'List',
      1,
      1,
      9,
      2,
    ]);
    expect(valueOf(ce, 'F')).toEqual(['List', 1, 1, 9, 2]);
  });

  test('an index with an effect is evaluated once', () => {
    // `Increment(c)` would run twice if the position were read before the
    // write and again by `ReplaceAt`.
    const ce = values();
    ce.assign('c', 0);
    ce.declare('next', {
      signature: '() -> integer',
      evaluate: () => {
        ce.assign('c', (ce.box('c').evaluate().re as number) + 1);
        return ce.number(2);
      },
    });
    const result = ce.box(['Assign', 'L', ['ReplaceAt', 'L', ['next'], 9]]);
    expect(result.evaluate().json).toEqual(['List', 10, 9, 30]);
    expect(valueOf(ce, 'c')).toBe(1);
  });

  test('an inner tuple follows ReplaceAt, and its positions are checked', () => {
    // `ReplaceAt` writes into a tuple as into a list, and gives a list.
    const ce = values();
    ce.assign('T', ce.box(['List', ['Tuple', 1, 2]]));
    expect(ce.parse('T[1, 1]\\coloneq 9').evaluate().json).toEqual([
      'List',
      ['List', 9, 2],
    ]);
    ce.assign('T', ce.box(['List', ['Tuple', 1, 2]]));
    expect(
      JSON.stringify(ce.parse('T[1, 3]\\coloneq 9').evaluate().json)
    ).toContain(OUT_OF_RANGE);
    expect(valueOf(ce, 'T')).toEqual(['List', ['Tuple', 1, 2]]);
  });
});

describe('the subscript spelling of an element is not an assignment to the list', () => {
  // `n_{1}` is the name of a local in a block (Tycho row 410). At the top
  // level, `n_{1} \coloneq 7` is an error, and the list `n` is unchanged: only
  // `n[1] \coloneq 7` changes it.
  test.each([
    ['a number index', 'n_{1}\\coloneq 7'],
    ['a symbol index', 'n_{k}\\coloneq 7'],
    ['a nested element', 'n_{1}[1]\\coloneq 7'],
    ['the spelling of a sequence definition', 'n_n\\coloneq n^2'],
  ])('%s', (_name, latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expr.evaluate();
    expect(valueOf(ce, 'n')).toEqual(['List', 1, 2, 3]);
  });

  test('in a block, it declares a local', () => {
    const ce = engine();
    const expr = ce.parse('n_{1}\\coloneq 7; n');
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'n_1', "'unknown'", 7],
      'n',
    ]);
    expect(expr.evaluate().json).toEqual(['List', 1, 2, 3]);
  });

  test('the bracket spelling changes the list', () => {
    const ce = engine();
    ce.parse('n[1]\\coloneq 7').evaluate();
    expect(valueOf(ce, 'n')).toEqual(['List', 7, 2, 3]);
  });
});

describe('the other assignment targets are unchanged', () => {
  test('`n_0` in a block is a new local, also with `n` a list', () => {
    const ce = engine();
    const expr = ce.parse('n_{0}\\coloneq 3; n_{0}+1');
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'n_0', "'unknown'", 3],
      ['Add', 'n_0', 1],
    ]);
    expect(expr.evaluate().json).toBe(4);
    expect(ce.box('n').evaluate().json).toEqual(['List', 1, 2, 3]);
  });

  test('`n_0` as a row of a cases block is a new local', () => {
    const ce = engine();
    const expr = ce.parse(
      '\\begin{cases} n_{0}\\coloneq 3 \\\\ n_{0}+1\\end{cases}'
    );
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'n_0', "'unknown'", 3],
      ['Add', 'n_0', 1],
    ]);
    expect(expr.evaluate().json).toBe(4);
  });

  test('`n_0` as a where item is a new local', () => {
    const ce = engine();
    const expr = ce.parse('n_{0}+1 \\text{ where } n_{0}\\coloneq 3');
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'n_0', "'unknown'", 3],
      ['Add', 'n_0', 1],
    ]);
    expect(expr.evaluate().json).toBe(4);
  });

  test.each([
    ['a statement', '\\operatorname{let} n_{0}=5; n_{0}+1', 6],
    [
      'a later statement',
      'a\\coloneq 1; \\operatorname{let} n_{0}=5; n_{0}+a',
      6,
    ],
    [
      'a row of a cases block',
      '\\begin{cases} \\operatorname{let} n_{0}=5 \\\\ n_{0}+1\\end{cases}',
      6,
    ],
    [
      'a let item of a where',
      'n_{0}+1 \\text{ where } \\operatorname{let} n_{0}=5',
      6,
    ],
  ])('`let n_0 = 5` declares the local `n_0`: %s', (_name, latex, value) => {
    // After `let`, `=` is the assignment, so the subscript on the list `n` is
    // the new name `n_0`, as with `\coloneq`. The later reads are that name.
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(JSON.stringify(expr.json)).toContain(
      '["Declare","n_0","\'unknown\'",5]'
    );
    expect(JSON.stringify(expr.json)).not.toContain('At');
    expect(expr.evaluate().json).toBe(value);
    expect(ce.box('n').evaluate().json).toEqual(['List', 1, 2, 3]);
    expectElementReadsUnchanged(ce);
  });

  test('`let n_k = 5` with a symbol index declares the local `n_k`', () => {
    const ce = engine();
    const declaration = ce.parse('\\operatorname{let} n_{k}=5', { form: 'raw' });
    expect(declaration.json).toEqual([
      'Block',
      ['Declare', 'n_k', "'unknown'", 5],
    ]);
    const block = ce.parse('\\operatorname{let} n_{k}=5; n_{k}+1');
    expect(block.evaluate().json).toBe(6);
  });

  test('`let` with `=` and a symbol target declares the symbol', () => {
    const ce = engine();
    expect(ce.parse('\\operatorname{let} x=5', { form: 'raw' }).json).toEqual([
      'Block',
      ['Declare', 'x', "'unknown'", 5],
    ]);
  });

  test('`x_k` with `x` not a list stays a subscript target', () => {
    const ce = engine();
    const expr = ce.parse('x_{k}\\coloneq 5');
    expect(expr.json).toEqual(['Assign', ['Subscript', 'x', 'k'], 5]);
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expectElementReadsUnchanged(ce);
  });

  test('`f(k)` defines `f`', () => {
    const ce = engine();
    const expr = ce.parse('f(j)\\coloneq 5');
    expect(expr.json).toEqual(['Assign', 'f', ['Function', ['Block', 5], 'j']]);
    expr.evaluate();
    expect(ce.parse('f(9)').evaluate().json).toBe(5);
    expectElementReadsUnchanged(ce);
  });

  test('`At` in the value of an assignment is a read', () => {
    const ce = engine();
    expect(ce.parse('a\\coloneq L[2]').evaluate().json).toBe(20);
    ce.parse('g(x)\\coloneq L[x]').evaluate();
    expect(ce.parse('g(3)').evaluate().json).toBe(30);
  });

  test('`ReplaceAt` gives a new list', () => {
    const ce = engine();
    expect(ce.box(['ReplaceAt', 'L', 2, 5]).evaluate().json).toEqual([
      'List',
      10,
      5,
      30,
    ]);
    expectElementReadsUnchanged(ce);
  });
});
