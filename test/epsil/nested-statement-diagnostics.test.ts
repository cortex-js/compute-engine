import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A NESTED statement (in a loop body, a function body, an `if` branch, a
// `do` block) whose value is discarded and holds an error is reported as a
// `runtime-error` diagnostic, as a non-final top-level statement is. The
// values the program computes do not change: a list keeps its failed cell
// (`docs/ERROR-MODEL.md` §3), and the loop continues.
//

const G = 'function g(x) { 1/x }\n';

function run(
  source: string,
  ce = new ComputeEngine()
): ReturnType<typeof executeEpsil> & { at: string[]; codes: string[] } {
  const result = executeEpsil(ce, source);
  return {
    ...result,
    // The source text under each diagnostic.
    at: result.diagnostics.map((d) => source.slice(d.range[0], d.range[1])),
    codes: result.diagnostics.map((d) => String(d.message[0])),
  };
}

const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

describe('EPSIL NESTED STATEMENT DIAGNOSTICS', () => {
  test('an error cell in a list built in a loop is reported once', () => {
    const r = run(
      G + 'let fs = []\nfor i in [1, 2] { fs = [...fs, g("a")] }\nfs'
    );
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.at).toEqual(['fs = [...fs, g("a")]']);
    expect(r.diagnostics[0].message).toEqual([
      'runtime-error',
      'expected `number`, got `string` at `a`',
      '',
      'incompatible-type',
    ]);
    // The loop ran both iterations, and the value keeps both failed cells.
    // A join of list literals folds to one list also when a cell failed.
    expect(r.value.toString()).toBe(`[${ERR},${ERR}]`);
  });

  test('the same statement at the top level gives the same diagnostic', () => {
    const top = run(G + 'let fs = []\nfs = [...fs, g("a")]\nfs');
    const nested = run(
      G + 'let fs = []\nfor i in [1] { fs = [...fs, g("a")] }\nfs'
    );
    expect(nested.diagnostics.map((d) => d.message)).toEqual(
      top.diagnostics.map((d) => d.message)
    );
    expect(nested.at).toEqual(top.at);
  });

  test('nested loops report the inner statement once', () => {
    const r = run(
      G +
        'let fs = []\nfor i in [1, 2] { for j in [1, 2] { fs = [...fs, g("a")] } }\nfs'
    );
    expect(r.at).toEqual(['fs = [...fs, g("a")]']);
    expect(r.value.errors.length).toBe(4);
  });

  test('an error in some iterations only is reported at the branch statement', () => {
    const r = run(
      G +
        'let ys = []\nlet n = 0\nfor i in [1, 2, 3] { if i == 2 { ys = [g("a")] } else { ys = [i] }; n = n + 1 }\n[ys, n]'
    );
    // The statement inside the branch, not the whole `if`.
    expect(r.at).toEqual(['ys = [g("a")]']);
    expect(r.value.toString()).toBe('[[3],3]');
  });

  test('the last statement of a loop body that is an `if` reports inside the branch', () => {
    const r = run(
      G +
        'let ys = []\nfor i in [1, 2, 3] { if i == 2 { ys = [g("a")] } else { ys = [i] } }\nys'
    );
    expect(r.at).toEqual(['ys = [g("a")]']);
    expect(r.value.toString()).toBe('[3]');
  });

  test('a `while` loop body reports its statement', () => {
    const r = run(
      G +
        'let n = 0\nlet fs = []\nwhile n < 2 { n = n + 1\n fs = [...fs, g("a")] }\nLength(fs)'
    );
    expect(r.at).toEqual(['fs = [...fs, g("a")]']);
  });

  test('a `do` block in a loop body reports its statement', () => {
    const r = run(
      G + 'let fs = []\nfor i in [1, 2] { do { fs = [...fs, g("a")] } }\nfs'
    );
    expect(r.at).toEqual(['fs = [...fs, g("a")]']);
  });

  test('a function called in a loop reports its body statement once', () => {
    const r = run(
      G +
        'function f(n) { let tmp = [g("a")]\n n }\nlet t = 0\nfor k in [1, 2, 3] { t = t + f(k) }\nt'
    );
    expect(r.at).toEqual(['let tmp = [g("a")]']);
    expect(r.value.toString()).toBe('6');
  });

  test('a lambda body reports its discarded statement', () => {
    const r = run(G + 'let k = (x) => do { let z = [g(x)]; 1 }\nk("a")');
    expect(r.at).toEqual(['let z = [g(x)]']);
    expect(r.value.toString()).toBe('1');
  });

  test('the last statement of a function body is not reported: the call reads it', () => {
    const r = run(G + 'function f() { [g("a")] }\nlet v = f()\nv');
    // The top-level statement that discards nothing but holds the error is
    // reported, as before; nothing inside `f`.
    expect(r.at).toEqual(['let v = f()']);
    expect(r.value.toString()).toBe(`[${ERR}]`);
  });

  test('the final top-level statement stays a value with no diagnostic', () => {
    const r = run(G + '[g("a")]');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe(`[${ERR}]`);
  });

  test('a loop that stops on an error value is reported once, at the loop', () => {
    const r = run(
      'let n = 0\nfor i in [1, 2] { n = n + 1; RuntimeError("bad") }\nn'
    );
    expect(r.at).toEqual([
      'for i in [1, 2] { n = n + 1; RuntimeError("bad") }',
    ]);
    // The loop stopped after the first iteration.
    expect(r.value.toString()).toBe('1');
  });

  test('a loop with no error gives no diagnostic', () => {
    const r = run('let fs = []\nfor i in [1, 2, 3] { fs = [...fs, i] }\nfs');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('[1,2,3]');
  });

  test('a function of an earlier program is not reported in a later one', () => {
    const ce = new ComputeEngine();
    run(G + 'function q(x) { let y = [g(x)]\n y }', ce);
    // The range of a statement of `q` indexes the earlier source; only the
    // statement of this program is reported.
    const r = run('let w = 0\nfor i in [1] { w = q("a") }\nw', ce);
    expect(r.at).toEqual(['w = q("a")']);
  });

  test('a call that does not match its signature keeps the signature notes', () => {
    const r = run(
      'function p(a, b) { a + b }\nlet xs = []\nfor i in [1] { xs = [p(1, 2, i)] }\nxs'
    );
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.diagnostics[0].message[3]).toBe('unexpected-argument');
    expect(r.diagnostics[0].notes?.length ?? 0).toBeGreaterThan(0);
  });

  test('the engine hook is removed when the run ends', () => {
    const ce = new ComputeEngine();
    run(G + 'for i in [1] { let z = [g("a")]; 0 }', ce);
    expect(ce._epsilStatementResultHook).toBeUndefined();
  });
});
