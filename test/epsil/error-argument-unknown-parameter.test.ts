import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// An argument whose value is an error passes through the argument check at
// every parameter type: the call is the error of the argument, with the
// frame of the call. With `let w = Ln("a")`, `op(w)` is the error of `Ln`
// for `function op(a) { a }` and `function op(a: number) { a }`. Before,
// `function op(a: unknown) { a }` gave a new error, "expected `unknown`,
// got `error` at `w`", and so did a parameter typed `list`, a tuple or
// `function`; a function with the two clauses `op(a: number)` and
// `op(a: string)` gave "expected `number | string`, got `error`". The check
// is in `validateArguments()` (`isErrorTypedOperand()`,
// `src/compute-engine/boxed-expression/validate.ts`).

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

/** The error of `Ln("a")` after it passed through the call `op` at its
 * argument `index`. */
function lnErrorThrough(index = 1): MathJsonExpression {
  return [
    'Error',
    ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
    "'a'",
    ['ErrorTrace', ['ErrorFrame', "'Ln'", 1], ['ErrorFrame', "'op'", index]],
  ];
}

/** The descriptions of the diagnostics of `source` that are not about the
 * definition of `w` (`Ln("a")`, which the program reports by design). */
function otherDiagnostics(source: string): unknown[] {
  return run(source)
    .diagnostics.filter(
      (d) =>
        !(
          Array.isArray(d.message) &&
          (String(d.message[2]).startsWith('ln(') ||
            String(d.message[2]).includes('in Ln argument'))
        )
    )
    .map((d) => d.message);
}

const PRE = 'let w = Ln("a")\n';

describe('AN ERROR ARGUMENT PASSES THROUGH A TYPED PARAMETER', () => {
  for (const annotation of [
    '',
    ': unknown',
    ': any',
    ': number',
    ': string',
    ': list',
    ': list<number>',
    ': tuple<unknown>',
    ': function',
  ]) {
    test(`\`function op(a${annotation}) { a }\`: op(w) is the error of Ln`, () => {
      const source = `${PRE}function op(a${annotation}) { a }\nop(w)`;
      expect(run(source).value.json).toEqual(lnErrorThrough());
      expect(otherDiagnostics(source)).toEqual([]);
    });
  }

  test('the definition with `=`: `op(a: unknown) = a`', () => {
    expect(run(`${PRE}op(a: unknown) = a\nop(w)`).value.json).toEqual(
      lnErrorThrough()
    );
  });

  test('the body does not read the parameter', () => {
    expect(
      run(`${PRE}function op(a: unknown) { 5 }\nop(w)`).value.json
    ).toEqual(lnErrorThrough());
  });

  test('the error argument is the second argument', () => {
    expect(
      run(`${PRE}function op(a: number, b: unknown) { b }\nop(1, w)`).value
        .json
    ).toEqual(lnErrorThrough(2));
  });
});

describe('AN ERROR ARGUMENT AT A FUNCTION WITH TWO CLAUSES SELECTS NO CLAUSE', () => {
  test('one parameter', () => {
    const source = `${PRE}function op(a: number) { 1 }\nfunction op(a: string) { 2 }\nop(w)`;
    expect(run(source).value.json).toEqual(lnErrorThrough());
    expect(otherDiagnostics(source)).toEqual([]);
  });

  test('two parameters, the other argument fits one clause', () => {
    expect(
      run(
        `${PRE}function op(a: number, b: number) { 1 }\nfunction op(a: string, b: string) { 2 }\nop(w, "x")`
      ).value.json
    ).toEqual(lnErrorThrough());
  });

  test('a value that fits a clause still selects it', () => {
    expect(
      run('function op(a: number) { 1 }\nfunction op(a: string) { 2 }\nop("x")')
        .value.json
    ).toBe(2);
  });

  test('a value that fits no clause is still refused', () => {
    expect(
      run('function op(a: number) { 1 }\nfunction op(a: string) { 2 }\nop(true)')
        .value.json
    ).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number | string'", "'boolean'"],
      'True',
      ['ErrorTrace', ['ErrorFrame', "'op'", 1]],
    ]);
  });
});

describe('AN ERROR ARGUMENT AT A LIBRARY OPERATOR OR A CONDITION', () => {
  /** The error of `Ln("a")` after it passed through `operator`. */
  function lnErrorAt(operator: string): MathJsonExpression {
    return [
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      "'a'",
      [
        'ErrorTrace',
        ['ErrorFrame', "'Ln'", 1],
        ['ErrorFrame', `'${operator}'`, 1],
      ],
    ];
  }

  test('`Conjugate(w)`: a parameter typed by a bounded type variable', () => {
    const source = `${PRE}Conjugate(w)`;
    expect(run(source).value.json).toEqual(lnErrorAt('Conjugate'));
    expect(otherDiagnostics(source)).toEqual([]);
  });

  test('`if (w) { 1 } else { 2 }`: the condition', () => {
    const source = `${PRE}if (w) { 1 } else { 2 }`;
    expect(run(source).value.json).toEqual(lnErrorAt('If'));
    expect(otherDiagnostics(source)).toEqual([]);
  });
});

describe('THE OTHER ARGUMENT CHECKS ARE UNCHANGED', () => {
  test('a value of the wrong type is refused', () => {
    const source = 'function op(a: number) { a }\nop("x")';
    expect(run(source).value.json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      "'x'",
      ['ErrorTrace', ['ErrorFrame', "'op'", 1]],
    ]);
    expect(otherDiagnostics(source)).toEqual([
      [
        'static-type-error',
        'expected `number`, got `string` at `x`',
        'op("x")',
        'incompatible-type',
      ],
    ]);
  });

  test('a missing argument is the `missing` error', () => {
    expect(run('function op(a: unknown) { a }\nop()').value.json).toEqual([
      'Error',
      "'missing'",
      ['ErrorTrace', ['ErrorFrame', "'op'", 1]],
    ]);
  });
});
