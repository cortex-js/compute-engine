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
