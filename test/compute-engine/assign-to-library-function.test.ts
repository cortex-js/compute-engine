import { ComputeEngine } from '../../src/compute-engine';
import { LatexSyntax } from '../../src/latex-syntax';

const CODE = 'assignment-to-library-function';

/** Every library function that the assignments below could replace still
 * gives its value. */
function expectLibraryUnchanged(ce: ComputeEngine): void {
  expect(ce.box(['Add', 1, 2]).evaluate().json).toBe(3);
  expect(ce.box(['Sin', 0]).evaluate().json).toBe(0);
  expect(ce.box(['First', ['List', 7, 8]]).evaluate().json).toBe(7);
  expect(ce.box(['At', ['List', 7, 8], 2]).evaluate().json).toBe(8);
  expect(ce.box(['Power', 2, 3]).evaluate().json).toBe(8);
  expect(ce.box(['N', ['Divide', 1, 4]]).evaluate().re).toBe(0.25);
  expect(ce.parse('\\frac{d}{dx}x^2').evaluate().json).toEqual([
    'Multiply',
    2,
    'x',
  ]);
}

describe('an assignment to a library function is a parse error', () => {
  test.each([
    // An operator notation has no name in the source.
    ['a sum', 'a+b\\coloneq 5', 'Add'],
    ['a sum, spelled :=', 'a+b:=5', 'Add'],
    ['a power', 'x^2\\coloneq 5', 'Power'],
    ['a fraction', '\\frac{a}{b}\\coloneq 5', 'Divide'],
    ['a negation', '-x\\coloneq 5', 'Negate'],
    ['an absolute value', '|x|\\coloneq 5', 'Abs'],
    ['a factorial', 'x!\\coloneq 5', 'Factorial'],
    ['a square root', '\\sqrt{x}\\coloneq 5', 'Sqrt'],
    ['a list', '[a,b]\\coloneq 5', 'List'],
    ['a set', '\\{a,b\\}\\coloneq 5', 'Set'],
    ['a parenthesized pair', '(a,b)\\coloneq 5', 'Delimiter'],
    ['a product', 'ab\\coloneq 5', 'InvisibleOperator'],
    ['a product with a number', '2x\\coloneq 5', 'InvisibleOperator'],
    ['a mean', '\\bar{x}\\coloneq 5', 'Mean'],
    ['a time derivative', '\\dot{x}\\coloneq 5', 'D'],
    ["a derivative head", "f'(x)\\coloneq 5", 'Apply'],
    // A library name in the source.
    ['a command', '\\sin(x)\\coloneq 5', 'Sin'],
    ['a lowercase operatorname', '\\operatorname{sin}(x)\\coloneq 5', 'Sin'],
    ['a capitalized name', '\\mathrm{Sin}(x)\\coloneq 5', 'Sin'],
    ['an operatorname', '\\operatorname{First}(L)\\coloneq 5', 'First'],
    ['a space before (', '\\operatorname{First} (L)\\coloneq 5', 'First'],
    ['a group around (', '\\operatorname{First}{(L)}\\coloneq 5', 'First'],
    ['a name of two operands', '\\operatorname{Add}(a,b)\\coloneq 5', 'Add'],
    ['a bare letter', 'N(x)\\coloneq x+1', 'N'],
    ['a bare letter of three parameters', 'D(x, y, k)\\coloneq x', 'D'],
    ['a Greek letter', '\\Gamma(t)\\coloneq 5', 'Gamma'],
    // A symbol target with a value that is a function.
    ['a symbol and a literal', '\\operatorname{First}\\coloneq x\\mapsto 5', 'First'],
    ['a symbol and a function name', '\\operatorname{Add}\\coloneq g', 'Add'],
    ['a letter and a literal', 'N\\coloneq x\\mapsto x+1', 'N'],
    ['a literal in parentheses', '\\operatorname{First}\\coloneq(x\\mapsto 5)', 'First'],
    ['a literal in two pairs', 'N\\coloneq((x\\mapsto x+1))', 'N'],
    ['a function name in parentheses', '\\operatorname{Add}\\coloneq(g)', 'Add'],
    // Every statement form, in which a local is declared.
    ['first of a block', 'a+b\\coloneq 5; 1+2', 'Add'],
    ['last of a block', 'y\\coloneq 1; a+b\\coloneq 5', 'Add'],
    ['a name, first of a block', '\\sin(x)\\coloneq 5; \\sin(0)', 'Sin'],
    ['a letter, first of a block', 'N(x)\\coloneq x+1; N(2)', 'N'],
    [
      'a symbol, first of a block',
      '\\operatorname{First}\\coloneq x\\mapsto 5; 1',
      'First',
    ],
    ['a row of a cases block', '\\begin{cases} a+b\\coloneq 5 \\\\ 2\\end{cases}', 'Add'],
    ['the row of a cases', '\\begin{cases} a+b\\coloneq 5\\end{cases}', 'Add'],
    ['a let statement', '\\operatorname{let} \\sin(x)\\coloneq 5', 'Sin'],
    ['a let in a block', '\\operatorname{let} a+b\\coloneq 5; 1+2', 'Add'],
    ['a where item', 'x+1 \\text{ where } a+b\\coloneq 5', 'Add'],
    ['a second where item', 'x+y \\text{ where } y\\coloneq 1, \\sin(z)\\coloneq 5', 'Sin'],
    ['a let item of a where', 'x+1 \\text{ where } \\operatorname{let} a+b\\coloneq 5', 'Add'],
    ['the body of a function', 'x\\mapsto(\\sin(y)\\coloneq 5)', 'Sin'],
    // A subscript on a library name: the definition of a function or of a
    // sequence with that name.
    ['a symbol subscript', 'N_n\\coloneq n+1', 'N'],
    ['a symbol subscript, spelled :=', 'N_n:=n+1', 'N'],
    ['a symbol subscript in braces', 'N_{n}\\coloneq n+1', 'N'],
    ['a subscript on an operatorname', '\\operatorname{Add}_n\\coloneq n', 'Add'],
    ['a subscript on a Greek letter', '\\Gamma_n\\coloneq n', 'Gamma'],
    ['a recurrence', 'N_n\\coloneq N_{n-1}+1', 'N'],
    ['a recurrence on another letter', 'D_n := n \\cdot D_{n-1}', 'D'],
    ['a recurrence with an offset index', 'N_{n+1}\\coloneq N_{n}+1', 'N'],
    ['a recurrence of two indices', 'N_{n,k}\\coloneq N_{n-1,k}+1', 'N'],
    ['a term of two indices with a symbol', 'N_{n,0}\\coloneq 1', 'N'],
    ['a function literal on a subscript', 'N_n\\coloneq x\\mapsto x', 'N'],
    ['a subscript in parentheses', '(N_n\\coloneq n+1)', 'N'],
    ['a subscript, the row of a cases', '\\begin{cases} N_n\\coloneq n+1\\end{cases}', 'N'],
    [
      'a subscript, a row with a condition',
      '\\begin{cases} N_n\\coloneq n+1 & x>0 \\\\ 0 & \\text{otherwise}\\end{cases}',
      'N',
    ],
    ['an offset index, first of a block', 'N_{n+1}\\coloneq 5; 2', 'N'],
    ['an offset index, last of a block', 'y\\coloneq 1; N_{n+1}\\coloneq 5', 'N'],
  ])('%s', (_name, latex, head) => {
    const ce = new ComputeEngine();
    ce.parse('g(x)\\coloneq x+1').evaluate();
    const expr = ce.parse(latex);
    const json = JSON.stringify(expr.json);
    expect(expr.isValid).toBe(false);
    expect(json).toContain(CODE);
    expect(json).toContain(`'${head}'`);
    expect(json).not.toContain('expected-a-symbol');
    expect(JSON.stringify(expr.evaluate().json)).toContain(CODE);
    expectLibraryUnchanged(ce);
  });

  test('the error spans the whole assignment, and is one error', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('a+b\\coloneq 5', { form: 'raw' }).json).toEqual([
      'Error',
      ['ErrorCode', `'${CODE}'`, "'Add'"],
      ['LatexString', "'a+b\\coloneq5'"],
    ]);
  });

  test('a symbol target spans the whole assignment', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\operatorname{Add}\\coloneq x\\mapsto 5', { form: 'raw' }).json
    ).toEqual([
      'Error',
      ['ErrorCode', `'${CODE}'`, "'Add'"],
      ['LatexString', "'\\operatorname{Add}\\coloneq x\\mapsto5'"],
    ]);
  });

  test('a target with no value keeps its error', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('a+b\\coloneq');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('unexpected-operator');
    expectLibraryUnchanged(ce);
  });

  test('a function of a library given to `ce.loadLibrary()` is refused', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary({
      name: 'my-lib',
      definitions: {
        Twice: {
          signature: '(number) -> number',
          evaluate: ([x], { engine }) => engine.number(2 * x.re),
        },
      },
    } as any);
    const expr = ce.parse('\\operatorname{Twice}(x)\\coloneq 5');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(ce.box(['Twice', 3]).evaluate().json).toBe(6);
  });

  test('a function of a library given to the constructor is refused', () => {
    const ce = new ComputeEngine({
      libraries: [
        'core',
        {
          name: 'my-lib',
          definitions: {
            Twice: {
              signature: '(number) -> number',
              evaluate: ([x], { engine }) => engine.number(2 * x.re),
            },
          },
        },
      ],
    } as any);
    const expr = ce.parse('\\operatorname{Twice}(x)\\coloneq 5');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
  });

  test('a function extended from the library is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('Add', { description: 'the sum' } as any, { extend: true } as any);
    const expr = ce.parse('a+b\\coloneq 5');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expectLibraryUnchanged(ce);
  });

  test('a value does not open the name to a later definition', () => {
    // After `N := 5`, `N(1/3)` still calls the library function, so a definition
    // of `N` would still replace it.
    const ce = new ComputeEngine();
    ce.parse('N\\coloneq 5').evaluate();
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(ce.box(['N', ['Divide', 1, 4]]).evaluate().re).toBe(0.25);
  });

  test('a read of the name does not open it to a later definition', () => {
    // Reading `N` as a value binds it to a value of unknown type. A parse must
    // not change what a later assignment can do.
    const ce = new ComputeEngine();
    ce.parse('[N, 1]');
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expect(ce.box(['N', ['Divide', 1, 4]]).evaluate().re).toBe(0.25);
  });

  test('a value of unknown type does not open the name', () => {
    const ce = new ComputeEngine();
    ce.parse('N\\coloneq y').evaluate();
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
  });
});

describe('the other assignments are unchanged', () => {
  test.each([
    ['a new function', 'f(k)\\coloneq 5', 'f'],
    ['a new function, spelled :=', 'f(k):=5', 'f'],
    ['a new function with a subscript', 'f_1(x)\\coloneq 5', 'f_1'],
    ['a new operatorname', '\\operatorname{foo}(x)\\coloneq 5', 'foo'],
    ['a new bold name', '\\mathbf{v}(x)\\coloneq 5', 'v_bold'],
  ])('%s defines the function', (_name, latex, head) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Assign');
    expect(expr.op1.symbol ?? expr.op1.toString()).toBe(head);
    expr.evaluate();
    expect(ce.box([head, 9]).evaluate().json).toBe(5);
    expectLibraryUnchanged(ce);
  });

  test('a new function can be defined again', () => {
    const ce = new ComputeEngine();
    ce.parse('f(k)\\coloneq 5').evaluate();
    ce.parse('f(k)\\coloneq 6').evaluate();
    expect(ce.parse('f(9)').evaluate().json).toBe(6);
  });

  test.each([
    ['a letter', 'N\\coloneq 5', 'N', 5],
    ['another letter', 'D\\coloneq 5', 'D', 5],
    ['a Greek letter', '\\Gamma\\coloneq 5', 'Gamma', 5],
    ['an operatorname', '\\operatorname{First}\\coloneq 5', 'First', 5],
  ])('a value in %s is a variable', (_name, latex, name, value) => {
    // The value does not replace the library function: `N(1/3)` still calls it.
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().json).toBe(value);
    expect(ce.box(name).evaluate().json).toBe(value);
    expectLibraryUnchanged(ce);
    expect(ce.box(['Gamma', 3]).evaluate().json).toBe(2);
  });

  test('a value in a block is a local with a library name', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N\\coloneq 5; N+1').evaluate().json).toBe(6);
    expect(ce.parse('D\\coloneq 5; D+1').evaluate().json).toBe(6);
    expectLibraryUnchanged(ce);
  });

  test('a library function can be a value of an assignment', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('g\\coloneq \\operatorname{Sin}');
    expect(expr.isValid).toBe(true);
    expectLibraryUnchanged(ce);
  });

  test('a parameter that has a library name can be defined in the body', () => {
    // Inside the body of `h`, `N` is the parameter, not the library function:
    // the parser reads the assignment. The block then refuses it for another
    // reason, a local with the name of a parameter (`variable-redeclaration`).
    const ce = new ComputeEngine();
    const latex = 'h(N)\\coloneq (N\\coloneq x\\mapsto x; 1)';
    const raw = JSON.stringify(ce.parse(latex, { form: 'raw' }).json);
    expect(raw).toContain('["Declare","N"');
    expect(raw).not.toContain(CODE);
    expectLibraryUnchanged(ce);
  });
});

describe('a subscript on a library name', () => {
  test('the definition `N_n := n + 1` does not replace `N`', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N(1/4)').evaluate().re).toBe(0.25);
    ce.parse('N_n\\coloneq n+1').evaluate();
    expect(ce.parse('N(1/4)').evaluate().re).toBe(0.25);
    ce.parse('\\operatorname{Add}_n\\coloneq n').evaluate();
    expect(ce.parse('\\operatorname{Add}(1,2)').evaluate().json).toBe(3);
    ce.parse('\\Gamma_n\\coloneq n').evaluate();
    expect(ce.parse('\\Gamma(3)').evaluate().json).toBe(2);
  });

  test('the error spans the whole assignment', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N_n\\coloneq n+1', { form: 'raw' }).json).toEqual([
      'Error',
      ['ErrorCode', `'${CODE}'`, "'N'"],
      ['LatexString', "'N_n\\coloneq n+1'"],
    ]);
  });

  test.each([
    ['an integer', 'N_0\\coloneq 1', ['Subscript', 'N', 0]],
    ['an integer in braces', 'N_{0}\\coloneq 1', ['Subscript', 'N', 0]],
    ['an integer of two digits', 'N_{10}\\coloneq 1', ['Subscript', 'N', 10]],
    [
      'two integers',
      'N_{0,0}\\coloneq 1',
      ['Subscript', 'N', ['Delimiter', ['Sequence', 0, 0], "','"]],
    ],
  ])('a term with %s as its index is valid', (_name, latex, target) => {
    // A term alone gives `N` no definition, so the function stays.
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(['Assign', target, 1]);
    expect(expr.evaluate().json).toBe('Nothing');
    expectLibraryUnchanged(ce);
  });

  test('the recurrence after a term is the error, and `N` stays', () => {
    const ce = new ComputeEngine();
    ce.parse('N_0\\coloneq 1').evaluate();
    const expr = ce.parse('N_n\\coloneq N_{n-1}+1');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
    expr.evaluate();
    expect(ce.isSequence('N')).toBe(false);
    expectLibraryUnchanged(ce);
  });

  test.each([
    ['the first statement of a block', 'N_n\\coloneq 5; N_n+1'],
    ['the first statement, in braces', 'N_{n}\\coloneq 5; N_{n}+1'],
    ['the first statement, a space before ;', 'N_n\\coloneq 5 ; N_n+1'],
    ['a later statement of a block', 'x\\coloneq 1; N_n\\coloneq 5; N_n+x'],
    ['the first row of a cases block', '\\begin{cases}N_n\\coloneq 5\\\\ N_n+1\\end{cases}'],
    [
      'a middle row of a cases block',
      '\\begin{cases}x\\coloneq 1\\\\N_n\\coloneq 5\\\\ N_n+x\\end{cases}',
    ],
    ['a where item', 'N_n+1 \\text{ where } N_n\\coloneq 5'],
    ['a let statement', '\\text{let } N_n\\coloneq 5; N_n+1'],
    ['an operatorname', '\\operatorname{Add}_n\\coloneq 5; \\operatorname{Add}_n+1'],
  ])('%s declares the local `N_n`', (_name, latex) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(true);
    expect(JSON.stringify(expr.json)).not.toContain(CODE);
    expect(expr.evaluate().json).toBe(6);
    // The local is gone after the block, and no name was defined outside it.
    expect(ce.lookupDefinition('N_n')).toBeUndefined();
    expectLibraryUnchanged(ce);
  });

  test('the last row of a cases block declares the local `N_n`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\begin{cases}x\\coloneq 1\\\\N_n\\coloneq 5\\end{cases}',
      { form: 'raw' }
    );
    expect(expr.json).toEqual([
      'Block',
      ['Declare', 'x', "'unknown'", 1],
      ['Declare', 'N_n', "'unknown'", 5],
    ]);
  });

  test('a local `N_n` in the body of a function', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x)\\coloneq (N_n\\coloneq x; N_n+1)').evaluate();
    expect(ce.parse('f(3)').evaluate().json).toBe(4);
    expectLibraryUnchanged(ce);
  });

  test('a declared name `N_n` is assigned, and `N` stays', () => {
    const ce = new ComputeEngine();
    ce.declare('N_n', 'number');
    const expr = ce.parse('N_n\\coloneq 5');
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().json).toBe(5);
    expect(ce.parse('N_n').evaluate().json).toBe(5);
    expectLibraryUnchanged(ce);
  });

  test('a declared name `N_n` is assigned in a parse that keeps the LaTeX', () => {
    // With `preserveLatex`, the subscript after a space is the object
    // `{ sym: 'n', latex: 'n' }`, not the string `n`.
    const ce = new ComputeEngine();
    ce.declare('N_n', 'number');
    const expr = ce.parse('N _{n}\\coloneq 5', { preserveLatex: true });
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().json).toBe(5);
    expect(ce.parse('N_n').evaluate().json).toBe(5);
    expectLibraryUnchanged(ce);
  });

  test('a subscript is the error in a parse that keeps the LaTeX', () => {
    const ce = new ComputeEngine();
    for (const latex of ['N_n\\coloneq n+1', 'N _{n}\\coloneq n+1']) {
      const expr = ce.parse(latex, { preserveLatex: true });
      expect(expr.isValid).toBe(false);
      expect(JSON.stringify(expr.json)).toContain(CODE);
      expr.evaluate();
    }
    expect(
      ce.parse('N _{n}\\coloneq 5; N_n+1', { preserveLatex: true }).evaluate()
        .json
    ).toBe(6);
    expectLibraryUnchanged(ce);
  });

  test('a name of several letters in the subscript is a variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('N_{max}\\coloneq 5');
    expect(expr.json).toEqual(['Assign', 'N_max', 5]);
    expr.evaluate();
    expect(ce.parse('N_{max}').evaluate().json).toBe(5);
    expectLibraryUnchanged(ce);
  });

  test('a text subscript after a space is the variable `N_max`', () => {
    // The space stops the parser from joining the subscript to the name, so
    // the target is `Subscript(N, "max")`, which evaluates to the name.
    const ce = new ComputeEngine();
    const expr = ce.parse('N _{\\text{max}}\\coloneq 5');
    expect(expr.json).toEqual(['Assign', ['Subscript', 'N', "'max'"], 5]);
    expect(expr.evaluate().json).toBe(5);
    expect(ce.parse('N_{\\text{max}}').evaluate().json).toBe(5);
    expectLibraryUnchanged(ce);
  });

  test('a symbol subscript after a space is the error', () => {
    const ce = new ComputeEngine();
    for (const latex of ['N _n\\coloneq n+1', 'N _{\\mathrm{max}}\\coloneq 5']) {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(false);
      expect(JSON.stringify(expr.json)).toContain(CODE);
      expr.evaluate();
    }
    expectLibraryUnchanged(ce);
  });

  test('a name that the host declared can be defined', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'unknown');
    const expr = ce.parse('N_n\\coloneq n+1');
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expect(ce.box(['N', 2]).evaluate().json).toBe(3);
  });

  test('a subscript on a name that is not in the library is a definition', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f_n\\coloneq n+1');
    expect(expr.json).toEqual([
      'Assign',
      ['Subscript', 'f', 'n'],
      ['Add', 'n', 1],
    ]);
    expr.evaluate();
    expect(ce.box(['f', 2]).evaluate().json).toBe(3);
    ce.parse('a_0\\coloneq 1').evaluate();
    ce.parse('a_n\\coloneq a_{n-1}+2').evaluate();
    expect(ce.parse('a_3').evaluate().json).toBe(7);
    expectLibraryUnchanged(ce);
  });

  test('the MathJSON form stays an explicit replacement', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', ['Subscript', 'N', 'n'], ['Add', 'n', 1]]).evaluate();
    expect(ce.box(['N', 2]).evaluate().json).toBe(3);
  });
});

describe('a program that replaces a library function declares it first', () => {
  test('`ce.declare()` with a type lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.declare('D', 'function');
    const expr = ce.parse('D(x, y, k)\\coloneq x+y+k');
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expect(ce.parse('D(1, 2, 3)').evaluate().json).toBe(6);
  });

  test('`ce.declare()` with a definition lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', {
      signature: '(number) -> number',
      evaluate: (_args, { engine }) => engine.number(42),
    });
    expect(ce.box(['Sin', 0]).evaluate().json).toBe(42);
    const expr = ce.parse('\\sin(x)\\coloneq 5');
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expect(ce.box(['Sin', 0]).evaluate().json).toBe(5);
  });

  test('`ce.declare()` after a read of the name lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.parse('[N, 1]');
    ce.declare('N', 'function');
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expect(ce.parse('N(2)').evaluate().json).toBe(3);
  });

  test('`ce.declare()` with a signature after a read lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.parse('[N, 1]');
    ce.declare('N', { signature: '(number) -> number' });
    expect(ce.parse('N(x)\\coloneq x+1').isValid).toBe(true);
  });

  test('a declaration with the type `unknown` lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'unknown');
    expect(ce.parse('N(x)\\coloneq x+1').isValid).toBe(true);
  });

  test('a declaration in a scope stays in the scope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('N', 'unknown');
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    ce.popScope();
    expect(ce.box(['N', ['Divide', 1, 4]]).evaluate().re).toBe(0.25);
  });

  test('a value given after a declaration does not open the name', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'number');
    ce.assign('N', 5);
    const expr = ce.parse('N(x)\\coloneq x+1');
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(CODE);
  });

  test('a function value with `ce.assign()` lets the name be defined', () => {
    const ce = new ComputeEngine();
    ce.assign('N', ce.parse('x\\mapsto x+1'));
    expect(ce.parse('N(x)\\coloneq x+2').isValid).toBe(true);
  });
});

describe('the routes that are not a LaTeX assignment', () => {
  test('the MathJSON form stays an explicit replacement', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Assign', 'Add', ['Function', 5, 'a', 'b']]);
    expect(expr.isValid).toBe(true);
    expr.evaluate();
    expect(ce.box(['Add', 1, 2]).evaluate().json).toBe(5);
  });

  test('the function spelling of `Assign` stays an explicit replacement', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\mathrm{Assign}(\\operatorname{Add}, x\\mapsto 5)');
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual([
      'Assign',
      'Add',
      ['Function', ['Block', 5], 'x'],
    ]);
  });

  test('`=` is a comparison', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x)=5');
    expect(expr.operator).toBe('Equal');
    expect(expr.isValid).toBe(true);
    expectLibraryUnchanged(ce);
  });

  test('a parser with no engine has no library', () => {
    const syntax = new LatexSyntax();
    expect(syntax.parse('a+b\\coloneq 5')).toEqual([
      'Assign',
      'Add',
      ['Function', 5, 'a', 'b'],
    ]);
  });
});
