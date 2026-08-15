import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { validEpsil } from '../utils';

function parseCodes(source: string): string[] {
  return parseEpsil(source)[1].map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

function execDiagnostics(source: string): string[][] {
  const ce = new ComputeEngine();
  return executeEpsil(ce, source).diagnostics.map((d) =>
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
    expect(executeEpsil(ce, 'let q = 7 // 2\nq').value.toString()).toBe('7');
  });
});

describe('positional `=`', () => {
  // `=` assigns only as the top-level operator of a statement whose left side
  // is a binding target; everywhere else it compares. `:=` always assigns and
  // `==` always compares.
  test('the canonical trap is now simply an equation', () => {
    // Previously `Assign`, which made `Solve` silently report no solutions.
    expect(validEpsil('Solve(x^2 = 4, x)')).toStrictEqual([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      'x',
    ]);
    expect(parseCodes('Solve(x^2 = 4, x)')).toEqual([]);
  });

  test('a condition compares rather than assigning', () => {
    expect(validEpsil('if a = true { 1 } else { 2 }')).toStrictEqual([
      'If',
      ['Equal', 'a', 'True'],
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('a statement with a binding target still assigns', () => {
    expect(validEpsil('x = 5')).toStrictEqual(['Assign', 'x', 5]);
    expect(validEpsil('x := 5')).toStrictEqual(['Assign', 'x', 5]);
  });

  test('`:=` in a condition warns — the assigned VALUE becomes the test', () => {
    // Positional `=` closed the implicit form of this trap; `:=` is
    // unconditional, so the explicit spelling still reaches a condition.
    // `if flag := true { … }` takes the branch and assigns, with no type error
    // to catch it, which is what makes a boolean assignment the sharp case.
    for (const src of [
      'if i := 5 { 1 } else { 2 }',
      'if flag := true { 1 }',
      'while i := 5 { }',
      '1 if (flag := true) else 2',
    ])
      expect([src, parseCodes(src)]).toEqual([src, ['assign-in-condition']]);

    // It is a WARNING: `:=` is the deliberate spelling, and the program parses.
    const [, diags] = parseEpsil('if flag := true { 1 }');
    expect(diags.map((d) => d.severity)).toEqual(['warning']);
  });

  test('…but only where a value is consumed AS a boolean', () => {
    // A bare `=` in a condition is already `Equal`, so there is nothing to
    // warn about; and an argument or element is odd but unambiguous.
    for (const src of [
      'if i = 5 { 1 } else { 2 }',
      'if i == 5 { 1 } else { 2 }',
      'if (i := 5) == 5 { 1 }',
      'f(a := 1)',
      '[a := 1]',
      'i := 5',
    ])
      expect([src, parseCodes(src)]).toEqual([src, []]);
  });

  test('a match GUARD is a condition too', () => {
    // A guard consumes its value as a boolean exactly like `if`/`while`.
    expect(parseCodes('match x { y if flag := true => 1 }')).toEqual([
      'assign-in-condition',
    ]);
    expect(parseCodes('match x { y if flag == true => 1 }')).toEqual([]);
  });

  test('the target must be a WRITTEN name, not one a fold produced', () => {
    // `+` is the identity, so `+x` reduces to the bare symbol `x`; and the
    // root of `true.x` is a literal word. Neither is a binding target, so
    // both compare.
    expect(validEpsil('+x = 5')).toStrictEqual(['Equal', 'x', 5]);
    expect(validEpsil('true.x = 1')).toStrictEqual([
      'Equal',
      ['Field', 'True', { str: 'x' }],
      1,
    ]);
    // …and the explicit spelling against a literal root is still rejected.
    expect(parseCodes('true.x := 1')).toContain('reserved-word');
    // Redundant parentheses around a name do NOT change what it is.
    expect(validEpsil('(x) = 5')).toStrictEqual(['Assign', 'x', 5]);
  });

  test('`a = b = 5` is diagnosed — it would assign a boolean', () => {
    expect(parseCodes('a = b = 5')).toContain('chained-assignment');
    // …but the explicit spellings are not: one chains, one compares.
    expect(parseCodes('a := b := 5')).toEqual([]);
    expect(parseCodes('a = (b = 5)')).toEqual([]);
    expect(parseCodes('a = b == 5')).toEqual([]);
  });

  test('`(a, b) = (b, a)` is diagnosed — the swap would not happen', () => {
    // A parenthesized left side is not a binding target, so this compares two
    // tuples and throws the result away.
    expect(parseCodes('(a, b) = (b, a)')).toContain(
      'destructuring-bare-equal'
    );
    // …but the explicit spellings are not: one destructures, one compares.
    expect(parseCodes('(a, b) := (b, a)')).toEqual([]);
    expect(parseCodes('(a, b) == (b, a)')).toEqual([]);
    // A computed component is a plausible tuple equation, not a typo.
    expect(parseCodes('(x + 1, y) = t')).toEqual([]);
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
  test('cross-language names suggest their Epsil operator', () => {
    const ce = new ComputeEngine();
    expect(ce.suggestOperatorName('Split')).toBe('StringSplit');
    expect(ce.suggestOperatorName('split')).toBe('StringSplit');
    expect(ce.suggestOperatorName('push')).toBe('Append');
    expect(ce.suggestOperatorName('Ceiling')).toBe('Ceil');
    // JavaScript Array method names
    expect(ce.suggestOperatorName('some')).toBe('Any');
    expect(ce.suggestOperatorName('every')).toBe('All');
  });

  test('the suggestion reaches the Epsil boundary diagnostic', () => {
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
  // namespace stays Epsil-native — the call itself remains inert.
  test('Wolfram names suggest their Epsil neighborhood', () => {
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

  test('the suggestions reach the Epsil boundary diagnostic', () => {
    expect(execDiagnostics('Total([1, 2, 3])')).toEqual([
      ['unknown-function', 'Total', 'Sum'],
    ]);
    expect(execDiagnostics('Select([1, 2, 3], x => x > 1)')).toEqual([
      ['unknown-function', 'Select', 'Filter'],
    ]);
    expect(execDiagnostics('MemberQ([1, 2], 1)')).toEqual([
      ['unknown-function', 'MemberQ', 'Contains'],
    ]);
  });

  test('a suggestion is only a warning — the call stays inert', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(ce, 'Total([1, 2, 3])');
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
    expect(execDiagnostics('Pi => Pi + 1')).toEqual([
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

  test('glyph aliases warn like their ASCII spelling', () => {
    // `π` canonicalizes to `Pi` at the lexer, so `f(π)` shadows the
    // constant exactly like `f(Pi)`.
    expect(execDiagnostics('f(π) = π + 1\nf(3)')).toEqual([
      ['parameter-shadows-constant', 'Pi'],
    ]);
  });

  test('literal parameters stay quiet', () => {
    // `Infinity`/`NaN` (and the glyph `∞`) are literal parameters, not
    // names — nothing is shadowed.
    expect(execDiagnostics('f(Infinity) = 1\nf(Infinity)')).toEqual([]);
    expect(execDiagnostics('f(∞) = 1\nf(∞)')).toEqual([]);
    expect(execDiagnostics('f(NaN) = 1\nf(NaN)')).toEqual([]);
  });

  test('the warning is advisory — semantics unchanged', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(ce, 'f(Pi) = Pi + 1\nf(3)');
    expect(value.toString()).toBe('4');
  });

  test('a USER const is not an engine constant — no warning', () => {
    // Cross-cell: `const Radius = 10` then a parameter named Radius. Only
    // SYSTEM-scope (builtin) constants are π-like; shadowing a user
    // binding with a parameter is unremarkable.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'const Radius = 10');
    const r = executeEpsil(ce, 'f(Radius) = Radius * 2\nf(3)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('6');
  });

  test('one diagnostic per name per run', () => {
    const r = execDiagnostics('f(Pi) = Pi + 1\ng(Pi) = Pi * 2');
    expect(r).toEqual([['parameter-shadows-constant', 'Pi']]);
  });
});
