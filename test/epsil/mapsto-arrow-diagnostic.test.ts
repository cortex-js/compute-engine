import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

//
// The `->` / `=>` typo diagnostic — see the companion-diagnostics section of
// `docs/LANGUAGE-MODEL.md`.
//
// A `KeyValuePair` whose left side is shaped like a parameter list — a typed
// parameter, a tuple of parameters, an empty `()`, or a bare symbol right
// after a grouping `(` or a `=` — is a function written with the wrong
// arrow. None of these shapes is a valid dictionary key (keys are strings),
// so the parser reports `mapsto-arrow-expected` with a fixit on the arrow and
// RECOVERS as the intended lambda. Legitimate dictionary spellings, and a
// rule argument right after the `(` of a call, stay silent.
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

  test('a parenthesized parameter in a call argument is diagnosed and recovered', () => {
    // The `(` before `x` opens a group, not the call's argument list, so
    // `(x) -> x^2` is the lambda `(x) => x^2` with the wrong arrow.
    const { value, diagnostics } = run('apply((x) -> x^2, 3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(9);
  });

  test('a bare symbol as the first of several call arguments is diagnosed and recovered', () => {
    // A function is the usual first argument (`map(f, xs)`), so `->` there
    // is read as the wrong-arrow spelling of `=>`. Only the ONLY argument
    // of a call is read as a rule.
    const { value, diagnostics } = run('map(x -> x^2, [1, 2])');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.toString()).toBe('[1,4]');
  });

  test('a bare symbol after a grouping `(` before `->` is diagnosed and recovered', () => {
    const { value, diagnostics } = run('const g = (x -> x + 1)\ng(3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(4);
  });

  test('a bare symbol after `=` before `->` is diagnosed and recovered', () => {
    const { value, diagnostics } = run('const g = x -> x + 1\ng(3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(4);
  });

  test('a bare symbol after a pipe operator before `->` is diagnosed and recovered', () => {
    // A pipe stage is always a function, never a dictionary entry, so
    // `xs |> x -> x^2` is the stage lambda `xs |> x => x^2` written with the
    // wrong arrow. Before this branch the pair reached the engine as
    // `KeyValuePair(x, x^2)` and failed at run time with "Function body must
    // be a scoped Block expression" — no diagnostic, no fixit.
    const src = '1..5 |> x -> x^2';
    const { value, diagnostics } = run(src);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.toString()).toBe('[1,4,9,16,25]');
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(0, start) + replacement + src.slice(end)).toBe(
      '1..5 |> x => x^2'
    );
    // The pipe is read from the token before the parameter, so the `~>`
    // spelling, the single-glyph spellings `▷` and `⇝`, and a comment
    // between the pipe and the parameter are all covered.
    for (const src of [
      '1..3 ~> n -> n + 1',
      '1..3 ▷ n -> n + 1',
      '1..3 ⇝ n -> n + 1',
      '1..3 |> /* stage */ n -> n + 1',
    ]) {
      const result = run(src);
      expect(result.diagnostics.map((d) => d.message[0])).toEqual([
        'mapsto-arrow-expected',
      ]);
      expect(result.value.toString()).toBe('[2,3,4]');
    }
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

  test('a rule as the only argument of a call', () => {
    // When a call has only one argument, a bare symbol right after the call's
    // `(` is the key of a rule argument, in the same way as after a `,`: the
    // serializer writes a rule argument this way. (GitHub issue #435.)
    for (const src of [
      'f(GridLines -> [10, 10])',
      'f(GridLines -> [10, 10],)',
      'f(x, GridLines -> [10, 10])',
      'c.m(GridLines -> 1)',
    ]) {
      const [value, diagnostics] = parseEpsil(src);
      expect(diagnostics).toEqual([]);
      expect(JSON.stringify(value)).not.toContain('"Function"');
      expect(JSON.stringify(value)).toContain('"KeyValuePair"');
    }
    const { diagnostics } = run('f(GridLines -> [10, 10])');
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
