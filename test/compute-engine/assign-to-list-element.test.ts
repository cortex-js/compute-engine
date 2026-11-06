import { ComputeEngine, compile } from '../../src/compute-engine';

const CODE = 'assignment-to-list-element';

/** An engine with the list `L`, the matrix `M` and the list `n`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 10, 20, 30]));
  ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
  ce.assign('n', ce.box(['List', 1, 2, 3]));
  return ce;
}

/** The library function `At` still reads an element of a list. */
function expectElementReadsUnchanged(ce: ComputeEngine): void {
  expect(ce.parse('L[2]').evaluate().json).toBe(20);
  expect(ce.box(['At', ['List', 7, 8], 2]).evaluate().json).toBe(8);
}

describe('an assignment to a list element is a parse error', () => {
  // Read as `head(args) := value`, each of these forms defined a function
  // named `At`. With a symbol index there was no error: at the top level the
  // definition replaced the library function for the whole engine, so that
  // `L[2]` gave `[5, 5, 5]`.
  test.each([
    ['a symbol index', 'L[k]\\coloneq 5'],
    ['a symbol index, spelled :=', 'L[k]:=5'],
    ['a number index', 'L[2]\\coloneq 5'],
    ['a sum index', 'L[k+1]\\coloneq 5'],
    ['two indexes', 'M[i, j]\\coloneq 5'],
    ['the function spelling', '\\operatorname{At}(L, k)\\coloneq 5'],
    [
      'the function spelling, a number index',
      '\\operatorname{At}(L, 2)\\coloneq 5',
    ],
    ['the upright spelling', '\\mathrm{At}(L, k)\\coloneq 5'],
    ['a space before the parenthesis', '\\operatorname{At} (L, k)\\coloneq 5'],
    ['the upright spelling, a space', '\\mathrm{At} (L, k)\\coloneq 5'],
    ['sized parentheses', '\\operatorname{At} \\left(L, k\\right)\\coloneq 5'],
    ['a group around the parentheses', '\\operatorname{At}{(L, k)}\\coloneq 5'],
    ['a space, in a sequence', '\\operatorname{At} (L, k)\\coloneq 5; L[2]'],
    [
      'a space, in a block',
      'L\\coloneq [10, 20, 30]; \\operatorname{At} (L, 2)\\coloneq 5; L[2]',
    ],
    [
      'a space, in a let',
      '\\operatorname{let} \\operatorname{At} (L, k)\\coloneq 5',
    ],
    [
      'a space, in a where',
      'x+1 \\text{ where } \\operatorname{At} (L, k)\\coloneq 5',
    ],
    ['a list that is not declared', 'Q[k]\\coloneq 5'],
    ['a subscript on a list, a symbol index', 'n_{k}\\coloneq 5'],
    ['a subscript on a list, a number index', 'n_{0}\\coloneq 5'],
    [
      'a block',
      'L\\coloneq [10, 20, 30]; k\\coloneq 2; L[k]\\coloneq 5; L[2]',
    ],
    ['the first statement of a sequence', 'L[k]\\coloneq 5; L[2]'],
    ['the value of an assignment', 'a\\coloneq L[k]\\coloneq 5'],
    ['a value that is an assignment', 'L[k]\\coloneq a\\coloneq 5'],
    [
      'a row of a cases block',
      '\\begin{cases} L[k]\\coloneq 5 \\\\ 2\\end{cases}',
    ],
    ['the row of a cases', '\\begin{cases} L[k]\\coloneq 5\\end{cases}'],
    ['a let statement', '\\operatorname{let} L[k]\\coloneq 5'],
    ['a let statement in a block', '\\operatorname{let} L[k]\\coloneq 5; L[2]'],
    ['a let statement with =', '\\operatorname{let} L[k]=5'],
    ['a let statement with =, in a block', '\\operatorname{let} L[k]=5; L[2]'],
    ['a where item', 'x+1 \\text{ where } L[k]\\coloneq 5'],
    [
      'a second where item',
      'x+a \\text{ where } a\\coloneq 1, L[k]\\coloneq 5',
    ],
    [
      'a let item of a where',
      'x+1 \\text{ where } \\operatorname{let} L[k]\\coloneq 5',
    ],
  ])('%s', (_name, latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(JSON.stringify(expr.json)).toContain('ReplaceAt');
    expect(JSON.stringify(expr.json)).not.toContain('expected-a-symbol');

    expect(JSON.stringify(expr.evaluate().json)).toContain(CODE);
    expectElementReadsUnchanged(ce);
  });

  test('the error spans the whole assignment, and is one error', () => {
    const ce = engine();
    expect(ce.parse('L[k+1]\\coloneq 5', { form: 'raw' }).json).toEqual([
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

  test('a cases row keeps the span of its target', () => {
    // The local reading of the row reads the right side first, which moves the
    // operand start of the parser.
    const ce = engine();
    expect(
      ce.parse('\\begin{cases} n_{k}\\coloneq 5\\end{cases}', { form: 'raw' })
        .json
    ).toEqual([
      'Which',
      'True',
      [
        'Error',
        ['ErrorCode', `'${CODE}'`, "'ReplaceAt'"],
        ['LatexString', "'n_{k}\\coloneq5'"],
      ],
    ]);
  });

  test('a target with no value keeps its error', () => {
    const ce = engine();
    expect(ce.parse('L[k]\\coloneq').isValid).toBe(false);
    expect(JSON.stringify(ce.parse('L[k]\\coloneq').json)).toContain(
      'unexpected-operator'
    );
  });

  test('the compilation of the block declines', () => {
    const ce = engine();
    const expr = ce.parse(
      'L\\coloneq [10, 20, 30]; k\\coloneq 2; L[k]\\coloneq 5; L[2]'
    );
    expect(() => compile(expr, { fallback: false } as any)).toThrow(/invalid/);
    expect((compile(expr) as any).success).toBe(false);
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
    const expr = ce.parse('f(k)\\coloneq 5');
    expect(expr.json).toEqual(['Assign', 'f', ['Function', ['Block', 5], 'k']]);
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
