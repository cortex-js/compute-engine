import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A block canonicalizes all of its statements before it runs the first one,
// and the `DefineFunction` canonical handler installs its clause at that
// time, onto the binding the block hoisted for the name. When a `let g: …`
// statement declares the signature of the function BEFORE its definition,
// the `Declare` statement finds a binding that already holds the clause
// (installed without the declaration), drops it, and declares the name
// fresh; the definition statement then installs its clause again, under the
// declared signature (`CLAUSE_INSTALLED_AHEAD`, `library/core.ts`).
//
// A call canonicalized before the `Declare` ran holds the dropped record by
// identity. Until 2026-10-21 that record kept the clause that was installed
// without the declaration, so the call ran a function whose parameter type
// was never checked: `g(1.5)` answered `3` where the Epsil runner, which
// runs the `let` before it boxes the definition, reports `incompatible-type`.
// The dropped record is now retired, as `ce.undeclare()` retires a record,
// and the call reads the definition the scope holds when it is evaluated.
//

const SIGNATURE = 'let g: (integer) -> integer\nfunction g(k) { 2 * k }\n';

function block(source: string): string {
  return new ComputeEngine()
    .box(parseEpsil(source)[0] as never)
    .evaluate()
    .toString();
}

function epsil(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

describe('A DECLARED SIGNATURE BEFORE THE DEFINITION, IN ONE BLOCK', () => {
  test('a float argument is refused against the declared parameter type', () => {
    const expected = 'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)';
    expect(block(SIGNATURE + 'g(1.5)')).toBe(expected);
    expect(epsil(SIGNATURE + 'g(1.5)')).toBe(expected);
    // Through a variable, and inside a nested `do` block.
    expect(block(SIGNATURE + 'let x = 1.5\ng(x)')).toBe(expected);
    expect(block('do {\n' + SIGNATURE + 'g(1.5) }')).toBe(expected);
  });

  test('an integer argument is applied', () => {
    expect(block(SIGNATURE + 'g(2)')).toBe('4');
    expect(block(SIGNATURE + '[g(2), g(3)]')).toBe('[4,6]');
  });

  test('a recursive definition with a typed signature still runs', () => {
    expect(
      block(
        'let f: (integer) -> integer\n' +
          'f(n) = if n <= 1 { 1 } else { n * f(n - 1) }\n' +
          'f(5)'
      )
    ).toBe('120');
  });

  test('a host block of MathJSON', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Block',
        ['Declare', 'g', "'(integer) -> integer'"],
        ['DefineFunction', 'g', ['Function', ['Multiply', 2, 'k'], 'k']],
        ['g', 1.5],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)'
    );
  });
});

//
// A call in a statement BETWEEN the declaration and the definition. The
// clause that the definition statement installed ahead was installed
// without the declaration, and the `Declare` statement drops it. When the
// declaration has no value, the `Declare` statement then installs the
// clause again at once, under the declared signature, so the call finds it
// and is checked against the signature. Until 2026-10-21 the call found no
// clause on both routes: `a` was `"g(2)"`, where the same program with the
// call before the `let` gave `"4"`.
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
    expect(block(src)).toBe('"4"');
    expect(epsilWithDiagnostics(src)).toEqual({
      value: '"4"',
      diagnostics: [],
    });
  });

  test('the declaration has no type', () => {
    const src = 'let g\nlet a = String(g(2))\nfunction g(k) { 2 * k }\na';
    expect(block(src)).toBe('"4"');
    expect(epsil(src)).toBe('"4"');
  });

  test('the call is checked against the declared parameter type', () => {
    const src =
      'let g: (integer) -> integer\nlet a = String(g(1.5))\nfunction g(k) { 2 * k }\na';
    const expected =
      'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)';
    expect(block(src)).toBe(expected);
    expect(epsil(src)).toBe(expected);
  });

  test('a later call outside the declared signature is still refused', () => {
    const src = BETWEEN + 'function g(k) { 2 * k }\n[a, g(1.5)]';
    expect(block(src)).toBe(
      '["4",Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)]'
    );
    // The static check of the Epsil runner reports the call, and the
    // program does not run.
    const { value, diagnostics } = epsilWithDiagnostics(src);
    expect(value).toBe(
      '[a,g(Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5))]'
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('static-type-error');
    expect(diagnostics[0]).toContain('incompatible-type');
  });

  test('a result outside the declared result type', () => {
    // The clause is accepted (its result is not annotated), and the call
    // reports the result, as a call after the definition does.
    const expected =
      'Error(ErrorCode("incompatible-type", "integer", "string"), "s")';
    const after = 'let g: (integer) -> integer\nfunction g(k) { "s" }\ng(2)';
    expect(block(after)).toBe(expected);
    expect(epsilWithDiagnostics(after)).toEqual({
      value: expected,
      diagnostics: [],
    });
    const between = BETWEEN + 'function g(k) { "s" }\na';
    expect(block(between)).toBe(expected);
    expect(epsil(between)).toBe(expected);
  });

  test('a clause outside the declared signature is reported by its statement', () => {
    const src = BETWEEN + 'function g(k: string) { k }\n[a, g(2)]';
    const blockValue = block(src);
    expect(blockValue).toContain('invalid-clause-definition');
    expect(blockValue).toContain('is not an arm of the declared type');
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
    expect(block(src)).toBe('["7","6"]');
    expect(epsil(src)).toBe('["7","6"]');
  });

  test('a recursive definition', () => {
    const src =
      'let f: (integer) -> integer\nlet a = String(f(5))\n' +
      'f(n) = if n <= 1 { 1 } else { n * f(n - 1) }\na';
    expect(block(src)).toBe('"120"');
    expect(epsil(src)).toBe('"120"');
  });

  test('in a nested block', () => {
    const src = 'do {\n' + BETWEEN + 'function g(k) { 2 * k }\na }';
    expect(block(src)).toBe('"4"');
    expect(epsil(src)).toBe('"4"');
  });

  test('on each run of a loop body', () => {
    const src =
      'let r = []\nfor i in [1, 2] {\nlet g: (integer) -> integer\n' +
      'let a = String(g(i))\nfunction g(k) { 2 * k }\nr = [...r, a] }\nr';
    expect(block(src)).toBe('["2","4"]');
    expect(epsil(src)).toBe('["2","4"]');
  });

  test('a program run again on the same engine', () => {
    const src = BETWEEN + 'function g(k) { 2 * k }\na';
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, src).value.toString()).toBe('"4"');
    expect(executeEpsil(ce, src).value.toString()).toBe('"4"');
  });

  test('a block evaluated again', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      parseEpsil(BETWEEN + 'function g(k) { 2 * k }\na')[0] as never
    );
    expect(expr.evaluate().toString()).toBe('"4"');
    expect(expr.evaluate().toString()).toBe('"4"');
  });

  test('on each run of a loop body, on the asynchronous route', async () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      parseEpsil(
        'let r = []\nfor i in [1, 2] {\nlet g: (integer) -> integer\n' +
          'let a = String(g(i))\nfunction g(k) { 2 * k }\nr = [...r, a] }\nr'
      )[0] as never
    );
    expect((await expr.evaluateAsync()).toString()).toBe('["2","4"]');
    const again = ce.box(
      parseEpsil(BETWEEN + 'function g(k) { 2 * k }\na')[0] as never
    );
    expect((await again.evaluateAsync()).toString()).toBe('"4"');
    expect((await again.evaluateAsync()).toString()).toBe('"4"');
  });

  test('in the body of a function called twice', () => {
    // The body runs in a new scope for each call. The call in the body
    // reads the clause installed when the body was canonicalized, without
    // the declared signature, so `h(1.5)` gives `3`: a known limit, the
    // same as before the clause was installed again by the declaration.
    const src =
      'function h(x) {\nlet g: (integer) -> integer\nlet a = String(g(x))\n' +
      'function g(k) { 2 * k }\na }\n[h(1), h(2)]';
    expect(block(src)).toBe('["2","4"]');
    expect(epsil(src)).toBe('["2","4"]');
  });

  test('two host statements that share one boxed name operand', () => {
    // `ce.box()` keeps a boxed operand as it is, so both `DefineFunction`
    // statements hold the same name operand. Both clauses are installed
    // again by the declaration.
    const ce = new ComputeEngine();
    const name = ce.box('g', { form: 'raw' });
    const value = ce
      .box([
        'Block',
        ['Declare', 'g', "'(integer | string) -> integer'"],
        [
          'Declare',
          'a',
          ['Dictionary', ['KeyValuePair', 'value', ['String', ['g', 2]]]],
        ],
        [
          'Declare',
          'b',
          [
            'Dictionary',
            ['KeyValuePair', 'value', ['String', ['g', { str: 'x' }]]],
          ],
        ],
        [
          'DefineFunction',
          name,
          ['Function', ['Multiply', 2, 'k'], ['Typed', 'k', "'integer'"]],
        ],
        ['DefineFunction', name, ['Function', 7, ['Typed', 's', "'string'"]]],
        ['List', 'a', 'b'],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('["4","7"]');
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
    expect(
      executeEpsil(ce, 'let g: (integer) -> integer\ng(2)').value.toString()
    ).toBe('g(2)');
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
