import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

// An unknown call stays an inert application. The did-you-mean warning
// (`unknown-function`) was found only in the RESULT of a statement, so a call
// that does not reach the result (the source of a loop that runs zero times,
// a condition, a function body, a branch that is not taken) gave no warning.
// The canonical form of each statement is now scanned too.

function run(
  source: string,
  ce = new ComputeEngine()
): { value: unknown; diagnostics: string[][] } {
  const result = executeEpsil(ce, source);
  return {
    value: result.value.json,
    diagnostics: result.diagnostics.map((d) =>
      (Array.isArray(d.message) ? d.message : [d.message]).map(String)
    ),
  };
}

describe('unknown call that does not reach the result', () => {
  test('the source of a for loop', () => {
    expect(run('for i in range(1, 3) { i }')).toEqual({
      value: 'Nothing',
      diagnostics: [['unknown-function', 'range', 'Range']],
    });
    expect(run('let s = 0; for i in rnage(1, 3) { s = s + i }; s')).toEqual({
      value: 0,
      diagnostics: [['unknown-function', 'rnage', 'Range']],
    });
  });

  test('a function body, a branch not taken, a while body', () => {
    expect(run('function k(n) { rnage(n) }; 1').diagnostics).toEqual([
      ['unknown-function', 'rnage', 'Range'],
    ]);
    expect(run('let n = 1; if (n > 5) { rnage(n) } else { 0 }')).toEqual({
      value: 0,
      diagnostics: [['unknown-function', 'rnage', 'Range']],
    });
    expect(
      run('let s = 0; while (s > 5) { s = rnage(s) }; s').diagnostics
    ).toEqual([['unknown-function', 'rnage', 'Range']]);
  });

  test('a print-like name in a function body', () => {
    expect(run('function q() { puts(1) }; 1').diagnostics).toEqual([
      ['print-not-available', 'puts'],
    ]);
  });

  test('a call in the result and in the canonical form is reported once', () => {
    expect(run('let r = rnage(2); [rnage(1), r]').diagnostics).toEqual([
      ['unknown-function', 'rnage', 'Range'],
    ]);
    expect(run('rnage(1)').diagnostics).toEqual([
      ['unknown-function', 'rnage', 'Range'],
    ]);
  });

  test('a name that the program binds is not reported', () => {
    // A parameter.
    expect(run('function g(rnage) { rnage(1) }; g((x) => x)')).toEqual({
      value: 1,
      diagnostics: [],
    });
    // A local function of a body.
    expect(run('function h() { let rnage = (z) => z; rnage(1) }; h()')).toEqual(
      { value: 1, diagnostics: [] }
    );
    // A function value bound by a later statement.
    expect(run('function q() { rnage(1) }; let rnage = (z) => z; q()')).toEqual(
      { value: 1, diagnostics: [] }
    );
    // A function defined by a later statement.
    expect(
      run('function q() { rangee(1) }; function rangee(a) { a }; q()')
    ).toEqual({ value: 1, diagnostics: [] });
  });

  test('a capture of a match pattern is a binding', () => {
    // The capture `puts` is lowered to the wildcard `_puts`, and the body
    // calls the bare name: the call invokes the captured function.
    expect(run('let f = (x) => x; match f { puts => puts(1) }')).toEqual({
      value: 1,
      diagnostics: [],
    });
    // A misspelled library call in a match body is still reported.
    expect(run('function k(v) { match v { n => rnage(n) } }; 1')).toEqual({
      value: 1,
      diagnostics: [['unknown-function', 'rnage', 'Range']],
    });
  });

  test('a function bound outside the program is not reported', () => {
    // A binding of an earlier program on the same engine.
    const ce = new ComputeEngine();
    run('let rnage = (z) => z', ce);
    expect(run('function q() { rnage(1) }; q()', ce)).toEqual({
      value: 1,
      diagnostics: [],
    });
    // A declaration of the host.
    const host = new ComputeEngine();
    host.declare('rnage', 'function');
    expect(run('for i in rnage(1, 3) { i }', host).diagnostics).toEqual([]);
  });

  test('a second run of the program on the same engine reports again', () => {
    // Boxing `rnage(1, 3)` declares `rnage` as a function with no value. That
    // declaration does not stop the warning in a later program.
    const ce = new ComputeEngine();
    const source = 'for i in rnage(1, 3) { i }';
    expect(run(source, ce).diagnostics).toEqual([
      ['unknown-function', 'rnage', 'Range'],
    ]);
    expect(run(source, ce).diagnostics).toEqual([
      ['unknown-function', 'rnage', 'Range'],
    ]);
  });

  test('the asynchronous driver reports the same warning', async () => {
    const ce = new ComputeEngine();
    const result = await executeEpsilAsync(ce, 'for i in rnage(1, 3) { i }');
    expect(result.value.json).toBe('Nothing');
    expect(
      result.diagnostics.map((d) =>
        (Array.isArray(d.message) ? d.message : [d.message]).map(String)
      )
    ).toEqual([['unknown-function', 'rnage', 'Range']]);
  });
});
