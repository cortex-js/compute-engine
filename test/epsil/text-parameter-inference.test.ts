import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A use of an untyped function parameter at a text parameter
// (`toUpperCase(s)`) infers `s` as `character | string`, because the string
// operators also accept a character. A later use of `s` at a collection
// parameter (`sort(s)`, `count(s)`, `startsWith(s, …)`) admits `string` but
// not `character`, so it narrows `s` to `string`. Before this narrowing, the
// program was refused with a type error when the text use came first, and
// accepted when it came last.
//

/** Run an Epsil program against a fresh engine, injecting the engine's own
 * LaTeX parser for `$…$` islands. */
function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

describe('EPSIL — a text use followed by a collection use of a parameter', () => {
  test('the text use first, then sort, count and startsWith', () => {
    const { value, diagnostics } = run(
      'g(s) = (toUpperCase(s), sort(s), count(s), startsWith(s, "c"))\ng("cab")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['Tuple', "'CAB'", "'abc'", 3, 'True']);
  });

  test('the collection use first, then the text use', () => {
    const { value, diagnostics } = run(
      'm(s) = (sort(s), toUpperCase(s))\nm("cab")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['Tuple', "'abc'", "'CAB'"]);
  });

  test('the text use in a block, then an overloaded collection use', () => {
    const { value, diagnostics } = run(
      'f(s) = do { let u = toUpperCase(s); take(s, 2) }\nf("cab")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual("'ca'");
  });

  test('a real character is still accepted at the text parameter', () => {
    const { value, diagnostics } = run('toUpperCase("abc"[1])');
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual("'A'");
  });
});
