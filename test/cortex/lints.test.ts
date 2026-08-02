import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';

function parseCodes(source: string): string[] {
  return parseCortex(source)[1].map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

function execDiagnostics(source: string): string[][] {
  const ce = new ComputeEngine();
  return executeCortex(ce, source).diagnostics.map((d) =>
    (Array.isArray(d.message) ? d.message : [d.message]).map(String)
  );
}

describe('floor-division comment lint', () => {
  test('warns when // after code reads as floor division', () => {
    expect(parseCodes('let q = 7 // 2')).toContain('floor-division-comment');
    expect(parseCodes('7//2')).toContain('floor-division-comment');
    expect(parseCodes('a + b // (2 + 1)')).toContain('floor-division-comment');
  });

  test('stays quiet for ordinary comments', () => {
    // Prose, doc comments, full-line comments, expected-output annotations.
    expect(parseCodes('let q = 7 // the 2nd item')).toEqual([]);
    expect(parseCodes('// 2')).toEqual([]);
    expect(parseCodes('let q = 3 /// 2')).toEqual([]);
    expect(parseCodes('Floor(7 / 2) // ok')).toEqual([]);
    expect(parseCodes('Sum(1..10) // ➔ 55')).toEqual([]);
  });

  test('the parse itself is unchanged (7 // 2 is still 7)', () => {
    const ce = new ComputeEngine();
    expect(executeCortex(ce, 'let q = 7 // 2\nq').value.toString()).toBe('7');
  });
});

describe('assign-in-argument lint', () => {
  test('warns for = inside call arguments', () => {
    expect(parseCodes('Solve(x^2 = 4, x)')).toContain('assign-in-argument');
    expect(parseCodes('f(a, b = 2)')).toContain('assign-in-argument');
  });

  test('stays quiet for == and ordinary assignments', () => {
    expect(parseCodes('Solve(x^2 == 4, x)')).toEqual([]);
    expect(parseCodes('let x = 5')).toEqual([]);
    expect(parseCodes('x = f(4)')).toEqual([]);
  });
});

describe('zero-index lint', () => {
  test('warns for a literal index 0', () => {
    expect(parseCodes('xs[0]')).toContain('zero-index');
    expect(parseCodes('m[0, 2]')).toContain('zero-index');
  });

  test('stays quiet for other indices and non-index zeros', () => {
    expect(parseCodes('xs[1]')).toEqual([]);
    expect(parseCodes('xs[-1]')).toEqual([]);
    expect(parseCodes('xs[k]')).toEqual([]);
    expect(parseCodes('f(0)')).toEqual([]);
    expect(parseCodes('[0, 1, 2]')).toEqual([]);
  });
});

describe('print hint', () => {
  test('print-like calls get a dedicated hint, once per name', () => {
    const diags = execDiagnostics('print("hi")\nprint("again")');
    expect(diags).toEqual([['print-not-available', 'print']]);
    expect(execDiagnostics('puts(42)')).toEqual([
      ['print-not-available', 'puts'],
    ]);
  });

  test('other unknown calls keep the did-you-mean path', () => {
    expect(execDiagnostics('f(2)')).toEqual([]);
    expect(execDiagnostics('len([1, 2])')).toEqual([
      ['unknown-function', 'len', 'Length'],
    ]);
  });
});

describe('curated did-you-mean synonyms', () => {
  test('cross-language names suggest their Cortex operator', () => {
    const ce = new ComputeEngine();
    expect(ce.suggestOperatorName('Split')).toBe('StringSplit');
    expect(ce.suggestOperatorName('split')).toBe('StringSplit');
    expect(ce.suggestOperatorName('push')).toBe('Append');
    expect(ce.suggestOperatorName('Ceiling')).toBe('Ceil');
    // JavaScript Array method names
    expect(ce.suggestOperatorName('some')).toBe('Any');
    expect(ce.suggestOperatorName('every')).toBe('All');
  });

  test('the suggestion reaches the Cortex boundary diagnostic', () => {
    expect(execDiagnostics('Split("a b", " ")')).toEqual([
      ['unknown-function', 'Split', 'StringSplit'],
    ]);
    expect(execDiagnostics('Ceiling(2.1)')).toEqual([
      ['unknown-function', 'Ceiling', 'Ceil'],
    ]);
  });
});

describe('curated did-you-mean synonyms — Wolfram Language names', () => {
  // Suggestions ONLY: no aliases are created, and the call shape often
  // differs from Wolfram's (`Accumulate[xs]` vs `Scan(xs, Add)`). The
  // namespace stays Cortex-native — the call itself remains inert.
  test('Wolfram names suggest their Cortex neighborhood', () => {
    const ce = new ComputeEngine();
    expect(ce.suggestOperatorName('Total')).toBe('Sum');
    expect(ce.suggestOperatorName('Select')).toBe('Filter');
    expect(ce.suggestOperatorName('Cases')).toBe('Filter');
    expect(ce.suggestOperatorName('MemberQ')).toBe('Contains');
    expect(ce.suggestOperatorName('Accumulate')).toBe('Scan');
    expect(ce.suggestOperatorName('RandomReal')).toBe('Random');
    expect(ce.suggestOperatorName('RandomInteger')).toBe('Random');
    expect(ce.suggestOperatorName('Nest')).toBe('Iterate');
    expect(ce.suggestOperatorName('NestList')).toBe('Iterate');
  });

  test('the suggestions reach the Cortex boundary diagnostic', () => {
    expect(execDiagnostics('Total([1, 2, 3])')).toEqual([
      ['unknown-function', 'Total', 'Sum'],
    ]);
    expect(execDiagnostics('Select([1, 2, 3], x |-> x > 1)')).toEqual([
      ['unknown-function', 'Select', 'Filter'],
    ]);
    expect(execDiagnostics('MemberQ([1, 2], 1)')).toEqual([
      ['unknown-function', 'MemberQ', 'Contains'],
    ]);
  });

  test('a suggestion is only a warning — the call stays inert', () => {
    const ce = new ComputeEngine();
    const { value } = executeCortex(ce, 'Total([1, 2, 3])');
    expect(value.operator).toBe('Total');
  });
});

describe('parameter-shadows-constant lint', () => {
  test('warns when a parameter is named after a multi-character constant', () => {
    expect(execDiagnostics('f(Pi) = Pi + 1\nf(3)')).toEqual([
      ['parameter-shadows-constant', 'Pi'],
    ]);
    expect(execDiagnostics('g(GoldenRatio) = 1')).toEqual([
      ['parameter-shadows-constant', 'GoldenRatio'],
    ]);
    // Anonymous mapsto literals have the same shadowing convention.
    expect(execDiagnostics('Pi |-> Pi + 1')).toEqual([
      ['parameter-shadows-constant', 'Pi'],
    ]);
  });

  test('single-letter constant names stay quiet (the variable namespace)', () => {
    // `e` and `i` ARE engine constants, but `f(i) = i + 1` is an ordinary
    // function of `i` — warning here would flag everyday math code.
    expect(execDiagnostics('h(e) = e^2\nh(2)')).toEqual([]);
    expect(execDiagnostics('k(i) = i + 1\nk(1)')).toEqual([]);
    expect(execDiagnostics('m(x) = x + 1\nm(1)')).toEqual([]);
  });

  test('non-constant and literal parameters stay quiet', () => {
    // `π` is an ordinary Cortex identifier (not bound to the constant), and
    // `Infinity`/`NaN` are literal parameters, not names.
    expect(execDiagnostics('f(π) = π + 1\nf(3)')).toEqual([]);
    expect(execDiagnostics('f(Infinity) = 1\nf(Infinity)')).toEqual([]);
    expect(execDiagnostics('f(NaN) = 1\nf(NaN)')).toEqual([]);
  });

  test('the warning is advisory — semantics unchanged', () => {
    const ce = new ComputeEngine();
    const { value } = executeCortex(ce, 'f(Pi) = Pi + 1\nf(3)');
    expect(value.toString()).toBe('4');
  });

  test('a USER const is not an engine constant — no warning', () => {
    // Cross-cell: `const Radius = 10` then a parameter named Radius. Only
    // SYSTEM-scope (builtin) constants are π-like; shadowing a user
    // binding with a parameter is unremarkable.
    const ce = new ComputeEngine();
    executeCortex(ce, 'const Radius = 10');
    const r = executeCortex(ce, 'f(Radius) = Radius * 2\nf(3)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('6');
  });

  test('one diagnostic per name per run', () => {
    const r = execDiagnostics('f(Pi) = Pi + 1\ng(Pi) = Pi * 2');
    expect(r).toEqual([['parameter-shadows-constant', 'Pi']]);
  });
});
