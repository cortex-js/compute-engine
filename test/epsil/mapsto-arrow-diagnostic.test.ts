import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The `->` / `=>` typo diagnostic — see the companion-diagnostics section of
// `docs/plans/2026-08-08-annotation-lambda-lift.md`.
//
// A `KeyValuePair` whose left side is shaped like a parameter list — a typed
// parameter, a tuple of parameters, an empty `()`, or a bare symbol right
// after `(` or `=` — is a function written with the wrong arrow. None of
// these shapes is a valid dictionary key (keys are strings), so the parser
// reports `mapsto-arrow-expected` with a fixit on the arrow and RECOVERS as
// the intended lambda. Legitimate dictionary spellings stay silent.
//

/** Run an Epsil program against a fresh engine. */
function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

describe('EPSIL MAPSTO-ARROW DIAGNOSTIC — wrong-arrow lambdas', () => {
  test('a typed parameter before `->` is diagnosed and recovered', () => {
    // The original field report: TypeScript/Java muscle memory.
    const src = 'const f = (x:number) -> x^2 + 2x + 1';
    const { value, diagnostics } = run(src + '\nf(3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(16);
    // The fixit replaces the arrow itself.
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(0, start) + replacement + src.slice(end)).toBe(
      'const f = (x:number) => x^2 + 2x + 1'
    );
  });

  test('a parenthesized parameter before `->` is diagnosed and recovered', () => {
    const { value, diagnostics } = run('const f = (x) -> x + 1\nf(3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(4);
  });

  test('a parameter tuple before `->` is diagnosed and recovered', () => {
    const { value, diagnostics } = run('const f = (a, b) -> a + b\nf(2, 3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(5);
  });

  test('an empty `()` before `->` is a zero-parameter lambda', () => {
    const { value, diagnostics } = run('const t = () -> 42\nt()');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(42);
  });

  test('a bare symbol after `=` before `->` is diagnosed and recovered', () => {
    const { value, diagnostics } = run('const g = x -> x + 1\ng(3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(4);
  });
});

describe('EPSIL MAPSTO-ARROW DIAGNOSTIC — legitimate `->` stays silent', () => {
  test('a brace dictionary with unquoted keys', () => {
    const { value, diagnostics } = run('const d = {one -> 1, two -> 2}\nd.one');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('a string-keyed pair outside braces', () => {
    const { diagnostics } = run('const e = "a" -> 1\ne');
    expect(diagnostics).toEqual([]);
  });

  test('the empty dictionary `{->}`', () => {
    const { diagnostics } = run('const z = {->}\nz');
    expect(diagnostics).toEqual([]);
  });

  test('a bare-symbol key in an unclaimed position keeps its static error', () => {
    // Not after `(` or `=`: a list element. The initializer-descent
    // static-type-error (non-string key) still applies, without any
    // wrong-arrow guess.
    const { diagnostics } = run('let f = [n -> n + 1]');
    expect(diagnostics.map((d) => d.message[0])).toEqual(['static-type-error']);
  });
});
