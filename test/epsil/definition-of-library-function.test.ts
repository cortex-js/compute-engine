import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A definition in math style whose name is a function of the library,
// `Sin(x) := 5`, would replace that function for every later computation on
// the engine. It is the parse error `assignment-to-library-function`, as the
// LaTeX `\sin(x) \coloneq 5` is, and the statement defines no function. The
// head `At` is an assignment to a list element: `At(xs, k) := 5` rebinds `xs`,
// as `xs[k] := 5` does.
//

function run(
  source: string,
  ce = new ComputeEngine()
): { value: unknown; codes: unknown[] } {
  const { value, diagnostics } = executeEpsil(ce, source);
  return { value: value.json, codes: diagnostics.map((d) => d.message) };
}

describe('an At head assigns to a list element', () => {
  test.each([
    ['`:=`', 'let xs = [7, 8]\nAt(xs, 1) := 5\nxs'],
    ['`=`', 'let xs = [7, 8]\nAt(xs, 1) = 5\nxs'],
    ['the verbatim name', 'let xs = [7, 8]\n`At`(xs, 1) := 5\nxs'],
  ])('%s', (_name, source) => {
    expect(run(source)).toEqual({ value: ['List', 5, 8], codes: [] });
  });

  test('the library function At is not replaced', () => {
    const ce = new ComputeEngine();
    expect(run('let xs = [7, 8]\nAt(xs, k) := 5\n[7, 8][2]', ce)).toEqual({
      value: 8,
      codes: [],
    });
    expect(ce.box(['At', ['List', 7, 8], 2]).evaluate().json).toEqual(8);
  });
});

describe('a library name as the head of a math definition is refused', () => {
  test.each([
    ['`:=`', 'Sin(x) := 5\nSin(0)'],
    ['`=`', 'Sin(x) = 5\nSin(0)'],
    ['a hold definition', 'hold Sin(x) := 5\nSin(0)'],
    ['a return type', 'Sin(x) -> integer = 5\nSin(0)'],
  ])('%s', (_name, source) => {
    const ce = new ComputeEngine();
    expect(run(source, ce)).toEqual({
      value: 0,
      codes: [['assignment-to-library-function', 'Sin']],
    });
    expect(ce.parse('\\sin(0)').evaluate().json).toEqual(0);
  });

  test('the error covers the statement, and later statements run', () => {
    const source = 'let a = 2\nSin(x) := 5\na + 1';
    const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
    expect(value.json).toEqual(3);
    expect(diagnostics.map((d) => d.range.slice(0, 2))).toEqual([[10, 21]]);
  });

  test('in a function body', () => {
    expect(run('function g() {\n  N(x) := 3\n  1\n}\ng()')).toEqual({
      value: 1,
      codes: [['assignment-to-library-function', 'N']],
    });
  });

  test('epsil check reports it before the program runs', () => {
    const { diagnostics } = checkEpsil(new ComputeEngine(), 'Sin(x) := 5');
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['assignment-to-library-function', 'Sin'],
    ]);
  });
});

describe('the definitions that stay valid', () => {
  test('a name of the program', () => {
    expect(run('f(x) := x + 1\nf(2)')).toEqual({ value: 3, codes: [] });
  });

  test('a multi-clause definition', () => {
    expect(run('f(0) = 1\nf(n) = n * f(n - 1)\nf(4)')).toEqual({
      value: 24,
      codes: [],
    });
  });

  test('a lowercase spelling shadows only that spelling', () => {
    const ce = new ComputeEngine();
    expect(run('sin(x) := 5\n[sin(0), Sin(0)]', ce)).toEqual({
      value: ['List', 5, 0],
      codes: [],
    });
    expect(ce.parse('\\sin(0)').evaluate().json).toEqual(0);
  });

  test('a function statement replaces the library function on purpose', () => {
    expect(run('function Sin(x) { 5 }\nSin(0)')).toEqual({
      value: 5,
      codes: [],
    });
  });

  test('a later math definition of a function that the program defined', () => {
    const ce = new ComputeEngine();
    expect(run('function Sin(x) { 5 }', ce).codes).toEqual([]);
    expect(run('Sin(x) := 6\nSin(0)', ce)).toEqual({ value: 6, codes: [] });
  });

  // A clause with another dispatch domain (`Sin(0)`) adds to the function of
  // the program. A clause with the same domain is the separate error
  // `function-redefinition`, as for any name.
  test.each([
    [
      'a clause',
      'function Sin(x) { 5 }\nSin(0) := 7\n[Sin(0), Sin(1)]',
      ['List', 7, 5],
    ],
    [
      'in a function body',
      'function g() {\n  function N(y) { 1 }\n  N(0) := 3\n  [N(0), N(1)]\n}\ng()',
      ['List', 3, 1],
    ],
    [
      'in a nested block, a local function',
      'function Sin(x) { 5 }\nfunction g() {\n  Sin(x) := 6\n  Sin(0)\n}\n[g(), Sin(0)]',
      ['List', 6, 5],
    ],
    [
      'in an interpolation',
      'function Sin(x) { 5 }\n"\\(do { Sin(0) := 7; Sin(0) })"',
      "'7'",
    ],
  ])(
    'a math definition after a function statement of the same program: %s',
    (_name, source, value) => {
      expect(run(source)).toEqual({ value, codes: [] });
    }
  );

  test.each([
    ['no parameter list', 'function Sin x { 5 }\nSin(x) := 5\nSin(0)'],
    ['no parentheses', 'function Sin;\nSin(x) := 5\nSin(0)'],
  ])(
    'a function statement that does not parse does not count: %s',
    (_name, source) => {
      const ce = new ComputeEngine();
      expect(run(source, ce).codes).toContainEqual([
        'assignment-to-library-function',
        'Sin',
      ]);
      expect(ce.parse('\\sin(0)').evaluate().json).toEqual(0);
    }
  );

  test('a function statement in an inner block does not count outside it', () => {
    expect(
      run('function g() {\n  function Sin(x) { 5 }\n  1\n}\nSin(x) := 6\nSin(0)')
    ).toEqual({
      value: 0,
      codes: [['assignment-to-library-function', 'Sin']],
    });
  });

  test('a function that the host declared', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', 'function');
    expect(run('Sin(x) := 5\nSin(0)', ce)).toEqual({ value: 5, codes: [] });
  });
});
