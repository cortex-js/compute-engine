import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';

// A collection whose elements may be absent is admitted where a collection
// of present values is expected (user decision 2026-10-07). `xs[i]` with a
// computed index is typed `string | missing`, so `map(i => xs[i], …)` is
// typed `list<missing | string>`. `stringJoin` accepts it before the program
// runs, and reports an absent element when it reads one. See
// `docs/ERROR-MODEL.md` §3, "A collection whose elements may be absent".

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

describe('EPSIL — a collection of possibly absent elements', () => {
  test('every element present: the join runs, with no diagnostic', () => {
    const source =
      'let xs = ["a", "b"]\nstringJoin(map(i => xs[i], [1, 2]), "")';
    expect(checkSource(source).diagnostics).toEqual([]);
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('"ab"');
  });

  test('an absent element: no static diagnostic, a run-time error that names it', () => {
    const source =
      'let xs = ["a", "b"]\nstringJoin(map(i => xs[i], [1, 3]), "")';
    // The static check accepts the program: whether `xs[3]` exists is a
    // question about the value, not the type.
    expect(checkSource(source).diagnostics).toEqual([]);
    const { value } = run(source);
    // The same error as the scalar case, `toUpperCase(xs[3])`.
    expect(value.json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'character | string'", "'missing'"],
      'Missing',
    ]);
  });

  test('a dictionary lookup with a computed key (exercism/rna-transcription)', () => {
    const source = [
      'let complement = {G -> "C", C -> "G", T -> "A", A -> "U"}',
      'toRna(dna) = stringJoin(map(c => complement[c], characters(dna)), "")',
      'toRna("ACGTGGTCTTAA")',
    ].join('\n');
    expect(checkSource(source).diagnostics).toEqual([]);
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('"UGCACCAGAAUU"');
  });
});
