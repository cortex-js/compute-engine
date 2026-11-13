import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// At the top level of an Epsil program, a `let g: …` statement with no value
// declares the signature of the function that a `function g` statement of
// the program defines: the clause is checked against that signature.
//
// In a block (a host `Block`, a `do` block, a loop body, a function body),
// a function statement declares a local, a variable, as a `let` does: a
// `let g: …` and a `function g` of the same block are two declarations of
// `g`, the error `variable-redeclaration`.
//

const SIGNATURE = 'let g: (integer) -> integer\nfunction g(k) { 2 * k }\n';

function epsil(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

/** The boxed block `json` declares one of its names twice. */
function expectRedeclared(json: unknown): void {
  const boxed = new ComputeEngine().box(json as never);
  expect(boxed.isValid).toBe(false);
  expect(JSON.stringify(boxed.json)).toContain('variable-redeclaration');
}

/** The Epsil program `source`, whose signature and function statement are
 * in a block, reports the second declaration. */
function expectEpsilRedeclared(source: string): void {
  const { diagnostics } = executeEpsil(new ComputeEngine(), source);
  expect(
    diagnostics.map((d) => d.message.map(String).join(' ')).join('\n')
  ).toContain('variable-redeclaration');
}

describe('A DECLARED SIGNATURE BEFORE THE DEFINITION, IN ONE BLOCK', () => {
  test('a float argument is refused against the declared parameter type', () => {
    const expected =
      'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)';
    expect(epsil(SIGNATURE + 'g(1.5)')).toBe(expected);
    // In a block, the signature and the function statement are two
    // declarations.
    expectRedeclared(parseEpsil(SIGNATURE + 'g(1.5)')[0]);
    expectEpsilRedeclared('do {\n' + SIGNATURE + 'g(1.5) }');
  });

  test('an integer argument is applied', () => {
    expect(epsil(SIGNATURE + 'g(2)')).toBe('4');
    expect(epsil(SIGNATURE + '[g(2), g(3)]')).toBe('[4,6]');
  });

  test('a recursive definition with a typed signature still runs', () => {
    expect(
      epsil(
        'let f: (integer) -> integer\n' +
          'f(n) = if n <= 1 { 1 } else { n * f(n - 1) }\n' +
          'f(5)'
      )
    ).toBe('120');
  });

  test('a host block of MathJSON', () => {
    expectRedeclared([
      'Block',
      ['Declare', 'g', "'(integer) -> integer'"],
      ['DefineFunction', 'g', ['Function', ['Multiply', 2, 'k'], 'k']],
      ['g', 1.5],
    ]);
  });
});

//
// At the top level of an Epsil program, a call in a statement BETWEEN the
// declaration and the definition reads the clause installed under the
// declared signature, and is checked against that signature.
//

const BETWEEN = 'let g: (integer) -> integer\nlet a = String(g(2))\n';

function epsilWithDiagnostics(source: string): {
  value: string;
  diagnostics: string[];
} {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  return {
    value: value.toString(),
    diagnostics: diagnostics.map((d) => d.message.map(String).join(' ')),
  };
}

describe('A CALL BETWEEN THE DECLARED SIGNATURE AND THE DEFINITION', () => {
  test('the call is resolved', () => {
    const src = BETWEEN + 'function g(k) { 2 * k }\na';
    expectRedeclared(parseEpsil(src)[0]);
    expect(epsilWithDiagnostics(src)).toEqual({
      value: '"4"',
      diagnostics: [],
    });
  });

  test('a declaration with no type is not a signature: it needs a value', () => {
    // Only a function type pairs with the `function` statement of the same
    // name. A `let g` with no type and no value is an error.
    const src = 'let g\nfunction g(k) { 2 * k }\ng(2)';
    expect(epsilWithDiagnostics(src).diagnostics.join('\n')).toContain(
      'declaration-without-value'
    );
  });

  test('the call is checked against the declared parameter type', () => {
    const src =
      'let g: (integer) -> integer\nlet a = String(g(1.5))\nfunction g(k) { 2 * k }\na';
    const expected =
      'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)';
    expectRedeclared(parseEpsil(src)[0]);
    expect(epsil(src)).toBe(expected);
  });

  test('a later call outside the declared signature is still refused', () => {
    const src = BETWEEN + 'function g(k) { 2 * k }\n[a, g(1.5)]';
    // The static check of the Epsil runner reports the call, and the call
    // does not run. The list literal holds the failed cell as it is, and its
    // other cell is evaluated (`a` is `"4"`), as for any list literal with a
    // failed cell.
    const { value, diagnostics } = epsilWithDiagnostics(src);
    expect(value).toBe(
      '["4",g(Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5))]'
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('static-type-error');
    expect(diagnostics[0]).toContain('incompatible-type');
  });

  test('a result outside the declared result type', () => {
    // The body gives a string for a positive argument and an integer
    // otherwise. Its type overlaps the declared result, so the clause is
    // accepted, and the call with `2` reports the result, as a call after
    // the definition does.
    const expected =
      'Error(ErrorCode("incompatible-type", "integer", "string"), "s")';
    const body = 'function g(k) { if k > 0 { "s" } else { 1 } }';
    const after = `let g: (integer) -> integer\n${body}\ng(2)`;
    expect(epsilWithDiagnostics(after)).toEqual({
      value: expected,
      diagnostics: [],
    });
    const between = BETWEEN + body + '\na';
    expect(epsil(between)).toBe(expected);
  });

  test('a clause whose body only returns a string is refused', () => {
    // A string has no value in common with the declared result `integer`,
    // so the clause is refused when it is defined.
    const src = 'let g: (integer) -> integer\nfunction g(k) { "s" }\ng(2)';
    const { diagnostics } = epsilWithDiagnostics(src);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('incompatible-type');
    expect(diagnostics[0]).toContain(
      'its body computes a value of type "string"'
    );
  });

  test('a clause outside the declared signature is reported by its statement', () => {
    // The body returns an integer, so only the parameter is outside the
    // declared signature.
    const src = BETWEEN + 'function g(k: string) { 1 }\n[a, g(2)]';
    const { value, diagnostics } = epsilWithDiagnostics(src);
    expect(value).toBe('["g(2)",g(2)]');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('invalid-clause-definition');
  });

  test('a declaration with a value keeps its value until the definition', () => {
    const src = 'let g = 5\nlet a = String(g)\nfunction g(k) { 2 * k }\na';
    expect(epsil(src)).toBe('"5"');
  });

  test('several clauses', () => {
    const src =
      'let g: (integer) -> integer\nlet a = String(g(0))\n' +
      'function g(0) { 7 }\nfunction g(k) { 2 * k }\n[a, String(g(3))]';
    expect(epsil(src)).toBe('["7","6"]');
  });

  test('a recursive definition', () => {
    const src =
      'let f: (integer) -> integer\nlet a = String(f(5))\n' +
      'f(n) = if n <= 1 { 1 } else { n * f(n - 1) }\na';
    expect(epsil(src)).toBe('"120"');
  });

  test('in a nested block', () => {
    const src = 'do {\n' + BETWEEN + 'function g(k) { 2 * k }\na }';
    expectRedeclared(parseEpsil(src)[0]);
    expectEpsilRedeclared(src);
  });

  test('on each run of a loop body', () => {
    const src =
      'let r = []\nfor i in [1, 2] {\nlet g: (integer) -> integer\n' +
      'let a = String(g(i))\nfunction g(k) { 2 * k }\nr = [...r, a] }\nr';
    expectRedeclared(parseEpsil(src)[0]);
    expectEpsilRedeclared(src);
  });

  test('a program run again on the same engine', () => {
    const src = BETWEEN + 'function g(k) { 2 * k }\na';
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, src).value.toString()).toBe('"4"');
    expect(executeEpsil(ce, src).value.toString()).toBe('"4"');
  });

  test('in the body of a function', () => {
    const src =
      'function h(x) {\nlet g: (integer) -> integer\nlet a = String(g(x))\n' +
      'function g(k) { 2 * k }\na }\n[h(1), h(2)]';
    expectEpsilRedeclared(src);
  });

  test('two host statements that share one boxed name operand', () => {
    // `ce.box()` keeps a boxed operand as it is, so both `DefineFunction`
    // statements hold the same name operand: each is a declaration.
    const ce = new ComputeEngine();
    const name = ce.box('g', { form: 'raw' });
    const value = ce.box([
      'Block',
      [
        'DefineFunction',
        name,
        ['Function', ['Multiply', 2, 'k'], ['Typed', 'k', "'integer'"]],
      ],
      ['DefineFunction', name, ['Function', 7, ['Typed', 's', "'string'"]]],
      ['g', 2],
    ] as never);
    expect(JSON.stringify(value.json)).toContain('variable-redeclaration');
  });

  test('a program that stopped before its definition ran', () => {
    // The first program stops in the loop, after the preparation step of
    // the Epsil runner installed the clause of `g` ahead, and before the
    // `let` and the `function` statements ran. A later program on the same
    // engine that declares `g` does not install that clause again.
    const stopped =
      'let c = 0\nwhile c >= 0 { c = c + 1 }\n' +
      BETWEEN +
      'function g(k) { 2 * k }\na';
    const ce = new ComputeEngine();
    const first = ce.withStepBudget({ steps: 2000 }, () =>
      executeEpsil(ce, stopped)
    );
    expect(first.value.toString()).toContain('step-budget');
    const ce2 = new ComputeEngine();
    ce2.withStepBudget({ steps: 2000 }, () => executeEpsil(ce2, stopped));
    expect(
      executeEpsil(
        ce2,
        'let g: (integer) -> integer\nfunction g(0) { 7 }\n' +
          '[String(g(0)), String(g(3))]'
      ).value.toString()
    ).toBe('["7",Error("no-matching-clause", g(3))]');
  });
});
