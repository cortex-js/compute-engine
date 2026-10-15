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
// A bare `name -> value` in a call argument is a rule (a `KeyValuePair`) in
// every argument position, so the parser cannot see the typo there. The
// static checker reports it instead when the callee's parameter at that
// position expects a function: same code, same fixit, no recovery.
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

describe('EPSIL MAPSTO-ARROW DIAGNOSTIC — a rule at a function parameter', () => {
  // The parser used to read `map(x -> x^2, xs)` as the lambda
  // `map(x => x^2, xs)`, because a function is the usual first argument. That
  // broke the round trip of a call whose first argument is a rule
  // (`f(GridLines -> 1, Axes -> 2)`), so the parser now reads a rule in every
  // argument position, and the typo is found from the callee's signature.

  test('a rule as the function argument of `map` is diagnosed, with a fixit', () => {
    const src = 'map(x -> x^2, [1, 2, 3])';
    const [ast, parseDiagnostics] = parseEpsil(src);
    expect(parseDiagnostics).toEqual([]);
    expect(JSON.stringify(ast)).toContain('"KeyValuePair"');
    expect(JSON.stringify(ast)).not.toContain('"Function"');

    const { diagnostics } = run(src);
    // One diagnostic: the type error the engine finds in the same rule (its
    // key `x` is a number, not a string) is the same problem.
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['mapsto-arrow-expected', 'map', '1'],
    ]);
    expect(diagnostics[0].severity).toBe('error');
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(start, end)).toBe('->');
    expect(src.slice(0, start) + replacement + src.slice(end)).toBe(
      'map(x => x^2, [1, 2, 3])'
    );
    expect(diagnostics[0].range.slice(0, 2)).toEqual([start, end]);

    // The fixed program runs.
    const fixed = run(src.slice(0, start) + replacement + src.slice(end));
    expect(fixed.diagnostics).toEqual([]);
    expect(fixed.value.toString()).toBe('[1,4,9]');
  });

  test('the parameter is found at any position and in an overload set', () => {
    for (const [src, callee, position] of [
      // `filter` takes the collection first and the predicate second.
      ['filter([1, 2, 3], x -> x > 1)', 'filter', '2'],
      ['reduce([1, 2, 3], x -> x)', 'reduce', '2'],
      // `sort` has one signature for strings and one for collections.
      ['sort([3, 1], x -> x)', 'sort', '2'],
      // The Unicode spelling of the arrow.
      ['map(x → x^2, [1, 2])', 'map', '1'],
    ] as const) {
      const { diagnostics } = run(src);
      expect(diagnostics.map((d) => d.message)).toEqual([
        ['mapsto-arrow-expected', callee, position],
      ]);
      const [start, end, replacement] = diagnostics[0].fixits![0];
      expect(replacement).toBe('=>');
      expect(['->', '→']).toContain(src.slice(start, end));
    }
  });

  test('a pipe stage counts the slot the piped value fills', () => {
    // With no `_`, the piped value fills the first slot its type fits:
    // the collection slot of `filter` (argument 1), so the written rule
    // fills the parameter of argument 2; the collection slot of `map` is
    // argument 2, so the rule fills the parameter of argument 1. The
    // message gives the position as written, which is 1 for both.
    for (const [src, callee, position] of [
      ['[1, 2, 3] |> filter(x -> x > 1)', 'filter', '1'],
      ['[1, 2, 3] |> map(x -> x^2)', 'map', '1'],
      ['[1, 2, 3] |> map(x -> x^2, _)', 'map', '1'],
    ] as const) {
      const { diagnostics } = run(src);
      expect(diagnostics.map((d) => d.message)).toEqual([
        ['mapsto-arrow-expected', callee, position],
      ]);
    }
  });

  test('a stage that canonicalization renames and reorders', () => {
    // `fold(f, init)` as a stage is `Fold(f, init, xs)`, and its canonical
    // form is `Reduce(xs, f, init)`. The errors of the stage are found in
    // the call as written, so the error that the wrong arrow causes (the
    // rule as a callback with one parameter) is hidden, and a real error is
    // underlined on the argument at fault.
    const { diagnostics } = run('let xs = [1, 2]\nxs |> fold(x -> x, 0)');
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['mapsto-arrow-expected', 'fold', '1'],
    ]);

    const src = 'let xs = [1, 2]\nxs |> fold(a => a, "0")';
    const real = run(src).diagnostics;
    expect(
      real.map((d) => [
        d.message[0],
        d.message[3],
        src.slice(d.range[0], d.range[1]),
      ])
    ).toEqual([['static-type-error', 'callback-arity', 'a => a']]);
  });

  test('a hidden error does not hide a different error with the same description', () => {
    // Both rules give the error "a key must be a string". The one of `map`
    // is hidden, because it is reported as a rule at a function slot. The
    // one of `f` is a different mistake, and is still reported.
    const { diagnostics } = run('(map(x -> x + 1, [1]), f(y -> y + 1))');
    expect(diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['mapsto-arrow-expected', undefined],
      ['static-type-error', 'incompatible-type'],
    ]);
    expect(diagnostics[1].message[1]).toContain('at `y`');
  });

  test('a second mistake inside the value of the rule is still reported', () => {
    // Only the errors that the wrong arrow causes are hidden: the error on
    // the key and the error on the rule as a callback. The `"a" + 1` in the
    // value is a different mistake, and fixing the arrow does not fix it.
    for (const src of ['map(x -> "a" + 1, [1])', '[1] |> map(x -> "a" + 1)']) {
      const { diagnostics } = run(src);
      expect(
        diagnostics.map((d) => [
          d.message[0],
          src.slice(d.range[0], d.range[1]),
        ])
      ).toEqual([
        ['mapsto-arrow-expected', '->'],
        ['static-type-error', '"a"'],
      ]);
    }
  });

  test('the error on the key is hidden when the statement has two rules', () => {
    // With two rules in one statement, the engine's error on a key cannot be
    // anchored on one pair, and falls back to the whole statement. It is
    // still the error that the wrong arrow causes.
    const { diagnostics } = run('map(x -> x^2, [1]) + map(y -> y, [2])');
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['mapsto-arrow-expected', 'map', '1'],
      ['mapsto-arrow-expected', 'map', '1'],
    ]);
  });

  test('a function parameter of a function the program defines', () => {
    const { diagnostics } = run(
      'function h(g: (number) -> number, y: number) { g(y) }\nh(x -> x + 1, 2)'
    );
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['mapsto-arrow-expected', 'h', '1'],
    ]);
  });

  test('a rule at a parameter that is not a function stays a rule', () => {
    for (const src of [
      'f(GridLines -> 1, Axes -> 2)',
      'f(GridLines -> 1, x)',
      'max(GridLines -> 1, 2)',
    ]) {
      const { diagnostics } = run(src);
      expect(
        diagnostics.filter((d) => d.message[0] === 'mapsto-arrow-expected')
      ).toEqual([]);
    }
  });

  test('the first argument of `apply` gets no hint', () => {
    // `Apply` declares its first parameter `any`, because it accepts a
    // function or the symbol of one, so the checker cannot see that
    // `x -> x^2` was meant as a function. Only the ordinary static type
    // error is reported (a rule key must be a string). The user decided to
    // leave it so: a narrower parameter type for `Apply`, or a second rule
    // that reads the key of a rule as a parameter when it occurs free in
    // the value, would both report legitimate rules as typos.
    const { diagnostics } = run('apply(x -> x^2, 3)');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
    ]);
    expect(diagnostics[0].fixits ?? null).toBeNull();
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

  test('a rule as an argument of a call', () => {
    // A bare symbol right after the call's `(` is the key of a rule
    // argument, in the same way as after a `,`, whatever the number of
    // arguments: the serializer writes a rule argument this way. (GitHub
    // issue #435.)
    for (const src of [
      'f(GridLines -> [10, 10])',
      'f(GridLines -> [10, 10],)',
      'f(x, GridLines -> [10, 10])',
      'f(GridLines -> 1, Axes -> 2)',
      'f(GridLines -> 1, x)',
      'c.m(GridLines -> 1)',
      'c.m(GridLines -> 1, Axes -> 2)',
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
