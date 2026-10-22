import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { narrowGuardedReads } from '../../src/epsil/presence-narrowing';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';

//
// Guard narrowing in the Epsil static check (slice S3 of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`): a read of a
// symbol inside the region where an `isMissing` test proves it present is
// not reported as a possibly absent argument. The run time is unchanged:
// the check rewrites the statement it boxes, not the program.
//

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(new ComputeEngine(), source);
  return {
    value: r.value.toString(),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    ),
  };
}

function narrowed(source: string): string {
  const [ast] = parseEpsil(source);
  const resolved = resolveLibraryNames(ast!, source, new ComputeEngine());
  return JSON.stringify(narrowGuardedReads(resolved), (k, v) =>
    k === 'sourceOffsets' ? undefined : v
  );
}

// `v` is typed `missing | string`: the index is not proved in range.
const PRELUDE =
  'function f(p: string) { p }\n' +
  'let xs: list<string> = ["a"]\n' +
  'let i: integer = 1\n' +
  'let v = xs[i]\n';

describe('an isMissing guard narrows the guarded symbol', () => {
  test('the else arm of `if isMissing(v)`', () => {
    const r = run(`${PRELUDE}if isMissing(v) { "none" } else { f(v) }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"a"');
  });

  test('the then arm of `if !isMissing(v)`', () => {
    const r = run(`${PRELUDE}if !isMissing(v) { f(v) } else { "none" }`);
    expect(r.diagnostics).toEqual([]);
  });

  test('the later operands of a conjunction and its then arm', () => {
    const r = run(
      `${PRELUDE}if !isMissing(v) && v != "b" { f(v) } else { "none" }`
    );
    expect(r.diagnostics).toEqual([]);
  });

  test('the later operands of a disjunction', () => {
    const r = run(`${PRELUDE}isMissing(v) || f(v) == "a"`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"True"');
  });

  test('a conditional expression', () => {
    const r = run(`${PRELUDE}let r = if isMissing(v) { "z" } else { f(v) }\nr`);
    expect(r.diagnostics).toEqual([]);
  });

  test('the absent arm itself is not narrowed', () => {
    const r = run(`${PRELUDE}if isMissing(v) { f(v) } else { "none" }`);
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('an unguarded arm is still reported', () => {
    const r = run(`${PRELUDE}if i > 0 { f(v) } else { "none" }`);
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('a reassignment inside the region ends it', () => {
    const r = run(`${PRELUDE}if !isMissing(v) { v := xs[2]\n f(v) } else { 0 }`);
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('a function literal in the region is not entered', () => {
    const r = run(
      `${PRELUDE}if !isMissing(v) { let g = () => f(v)\n g() } else { 0 }`
    );
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('a guard inside a function body narrows', () => {
    const r = run(
      `${PRELUDE}function h() { if isMissing(v) { "none" } else { f(v) } }\nh()`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"a"');
  });

  test('a loop body whose index is another name is narrowed', () => {
    const r = run(
      `${PRELUDE}let ys = [1, 2]\nif !isMissing(v) { for w in ys { f(v) } } else { 0 }`
    );
    expect(r.diagnostics).toEqual([]);
  });

  test('a reassignment later in a loop body ends the proof for the whole loop', () => {
    const r = run(
      `${PRELUDE}let k = 0\nif !isMissing(v) { while k < 2 { f(v)\n v := xs[5]\n k := k + 1 } } else { 0 }`
    );
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('the right side of an assignment to the symbol is still in the region', () => {
    const r = run(`${PRELUDE}if !isMissing(v) { v := f(v) } else { 0 }`);
    expect(r.diagnostics).toEqual([]);
  });

  test('a message about a narrowed statement quotes the symbol, not the wrapper', () => {
    const r = run(
      `${PRELUDE}function g(p: integer) { p }\nif !isMissing(v) { g(v) } else { 0 }`
    );
    expect(r.diagnostics.join(' ')).toContain('g(v)');
    expect(r.diagnostics.join(' ')).not.toContain('?!');
  });

  test('the run time is unchanged: the absent arm is taken when absent', () => {
    const r = run(
      'function f(p: string) { p }\nlet xs: list<string> = ["a"]\nlet i: integer = 3\nlet v = xs[i]\nif isMissing(v) { "none" } else { f(v) }'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"none"');
  });
});

describe('the rewrite the check boxes', () => {
  test('wraps the guarded read only', () => {
    expect(narrowed('if isMissing(v) { g(v) } else { f(v) }')).toBe(
      '{"fn":["If",{"fn":["IsMissing",{"sym":"v"}]},{"fn":["Block",{"fn":["g",{"sym":"v"}]}]},{"fn":["Block",{"fn":["f",{"fn":["AssertPresent",{"sym":"v"}]}]}]}]}'
    );
  });

  test('leaves a statement without a guard as the same object', () => {
    const [ast] = parseEpsil('f(v)');
    expect(narrowGuardedReads(ast!)).toBe(ast);
  });

  test('keeps a string literal and a dictionary intact', () => {
    expect(
      narrowed('if isMissing(v) { {a -> "x"} } else { {a -> f(v)} }')
    ).toContain('{"str":"x"}');
  });

  test('does not wrap a binding position', () => {
    expect(narrowed('if !isMissing(v) { v := 1 } else { 0 }')).not.toContain(
      'AssertPresent'
    );
  });

  test('wraps the right side of an assignment to the symbol', () => {
    expect(narrowed('if !isMissing(v) { v := f(v) } else { 0 }')).toContain(
      '{"fn":["Assign",{"sym":"v"},{"fn":["f",{"fn":["AssertPresent",{"sym":"v"}]}]}]}'
    );
  });

  test('narrows a loop body and leaves the loop index alone', () => {
    const out = narrowed('if !isMissing(v) { for w in ys { f(v) } } else { 0 }');
    expect(out).toContain('{"fn":["f",{"fn":["AssertPresent",{"sym":"v"}]}]}');
    expect(out).toContain('{"fn":["Element",{"sym":"w"},{"sym":"ys"}]}');
  });

  test('a loop that rebinds the symbol hides the proof in its body', () => {
    expect(
      narrowed('if !isMissing(v) { for v in ys { f(v) } } else { 0 }')
    ).not.toContain('AssertPresent');
  });
});
