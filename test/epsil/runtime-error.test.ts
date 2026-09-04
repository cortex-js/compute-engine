import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// `RuntimeError("code")` from Epsil: the way a program constructs an error
// VALUE of its own. A written `Error("code")` is a static diagnostic node
// (it invalidates the function literal around it, so the definition never
// takes effect); `RuntimeError` is an ordinary call whose evaluation yields
// the `Error` value, which then flows like any engine-raised failure —
// through application, `match`, and `if let v: !error = …`.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

const G = 'function g(x) { if x > 0 { x } else { RuntimeError("neg") } }\n';

describe('EPSIL RuntimeError', () => {
  test('parses and serializes as an ordinary call', () => {
    const [ast, diags] = parseEpsil('RuntimeError("neg")');
    expect(diags).toEqual([]);
    expect(serializeEpsil(ast!)).toBe('RuntimeError("neg")');
  });

  test('a function that fails on purpose is defined, and returns the error', () => {
    const r = run(G + '[g(1), g(-1)]');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[1,Error("neg")]');
  });

  test('a written `Error(…)` in the same body still does not define the function', () => {
    // The contrast this operator exists for: the static node invalidates
    // the literal, the statement reports it, and `g` stays undefined.
    const r = run(
      'function g(x) { if x > 0 { x } else { Error("neg") } }\ng(1)'
    );
    expect(r.value?.toString()).toBe('g(1)');
    expect(r.diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
  });

  test('`if let v: !error` refuses it and `match Error(c)` reads its code', () => {
    expect(
      run(
        G + 'if let v: !error = g(-2) { v } else { "recovered" }'
      ).value?.toString()
    ).toBe('"recovered"');
    expect(
      run(
        G + 'if let v: !error = g(2) { v * 10 } else { "recovered" }'
      ).value?.toString()
    ).toBe('20');
    expect(
      run(
        G + 'match g(-1) {\n  Error(c) => c\n  _ => "ok"\n}'
      ).value?.toString()
    ).toBe('"neg"');
  });

  test('a bare error value binds, and a non-final one is reported', () => {
    const bound = run('let e = RuntimeError("custom")\ne');
    expect(bound.value?.toString()).toBe('Error("custom")');
    // The `let` is a non-final statement whose value is an error: that is
    // the ordinary `runtime-error` diagnostic, raised in place.
    expect(bound.diagnostics.map((d) => d.message.slice(0, 2))).toEqual([
      ['runtime-error', 'custom'],
    ]);
    const structured = run('RuntimeError(ErrorCode("bad-arg", 3))');
    expect(structured.value?.toString()).toBe('Error(ErrorCode("bad-arg", 3))');
  });
});
