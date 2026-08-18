import {
  parseCheckArguments,
  parseCliArguments,
  parseDocArguments,
  CliUsageError,
} from '../../src/cli/arguments';
import {
  formatDiagnostics,
  formatValue,
  hasErrors,
} from '../../src/cli/format';
import { main, type CliIo } from '../../src/cli/main';
import { isRecoverable } from '../../src/cli/repl';
import { makeEpsilSession } from '../../src/cli/session';

function makeIo(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdin: {
      isTTY: false,
      setEncoding() {},
      async *[Symbol.asyncIterator]() {},
    } as unknown as NodeJS.ReadStream,
    stdout: {
      isTTY: false,
      write: (s: string) => ((out += s), true),
    } as unknown as NodeJS.WriteStream,
    stderr: {
      isTTY: false,
      write: (s: string) => ((err += s), true),
    } as unknown as NodeJS.WriteStream,
    env: {},
  };
  return { io, stdout: () => out, stderr: () => err };
}

describe('Epsil CLI arguments', () => {
  test('parses execution and output options', () => {
    expect(
      parseCliArguments(['--json', '--time-limit', '250', '-e', '1 + 2'], {})
    ).toMatchObject({
      eval: '1 + 2',
      outputMode: 'json',
      timeLimit: 250,
      color: true,
    });
  });

  test('accepts zero as no time limit', () => {
    expect(parseCliArguments(['--time-limit', '0'], {}).timeLimit).toBe(0);
  });

  test('rejects conflicting input and output options', () => {
    expect(() => parseCliArguments(['-e', '1', 'program.epsil'])).toThrow(
      CliUsageError
    );
    expect(() => parseCliArguments(['--json', '--epsil'])).toThrow(
      CliUsageError
    );
    expect(() => parseCliArguments(['--time-limit', '-1'])).toThrow(
      CliUsageError
    );
  });

  test('parses the diagnostics format', () => {
    expect(parseCliArguments([], {}).diagnosticsFormat).toBe('text');
    expect(
      parseCliArguments(['--diagnostics', 'json'], {}).diagnosticsFormat
    ).toBe('json');
    expect(() => parseCliArguments(['--diagnostics', 'yaml'], {})).toThrow(
      CliUsageError
    );
  });

  test('parses check and doc subcommand options', () => {
    expect(parseCheckArguments(['-e', '1 + 2', '--json'], {})).toMatchObject({
      eval: '1 + 2',
      json: true,
    });
    expect(() => parseCheckArguments(['-e', '1', 'a.epsil'], {})).toThrow(
      CliUsageError
    );

    expect(
      parseDocArguments(['greatest', 'common', 'divisor', '--limit', '3'])
    ).toEqual({ query: 'greatest common divisor', json: false, limit: 3 });
    expect(() => parseDocArguments([])).toThrow(CliUsageError);
    expect(() => parseDocArguments(['Sin', '--limit', '0'])).toThrow(
      CliUsageError
    );
  });
});

describe('Epsil CLI check command', () => {
  test('exits 0 and prints nothing for a well-formed program', async () => {
    const { io, stdout, stderr } = makeIo();
    expect(await main(['check', '-e', 'let x = 5\nx + 1'], io)).toBe(0);
    expect(stdout()).toBe('');
    expect(stderr()).toBe('');
  });

  test('reports syntax errors without evaluating', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', '1 +'], io)).toBe(1);
    expect(stderr()).toContain('Unexpected symbol "+"');
  });

  test('emits a JSON envelope with locations and fix-its', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['check', '-e', 'a+ b', '--json'], io)).toBe(0);
    const envelope = JSON.parse(stdout());
    expect(envelope.ok).toBe(true);
    expect(envelope.diagnostics).toHaveLength(1);
    expect(envelope.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'asymmetric-operator-whitespace',
      line: 1,
      fixits: [{ start: 1, end: 2, value: ' + ' }],
    });
  });

  test('reports error diagnostics in the JSON envelope', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['check', '-e', '1 @ 2', '--json'], io)).toBe(1);
    const envelope = JSON.parse(stdout());
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].severity).toBe('error');
    expect(typeof envelope.diagnostics[0].message).toBe('string');
  });
});

describe('Epsil CLI check: canonicalization-time type errors', () => {
  test('reports a static type error, anchored to its statement', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', '"a" + 1'], io)).toBe(1);
    expect(stderr()).toContain(
      'error: Type error: expected `number`, got `string` at `a` in `"a" + 1`'
    );
    expect(stderr()).toContain('--> 1:1');
  });

  test('anchors to the offending operand of a multi-statement program', async () => {
    const { io, stdout } = makeIo();
    expect(
      await main(['check', '-e', 'let x = 5\nx + "a"', '--json'], io)
    ).toBe(1);
    const envelope = JSON.parse(stdout());
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics).toHaveLength(1);
    // The `"a"` on line 2, not the statement that contains it: the error's
    // position in the canonical tree names the call it belongs to, which is
    // matched back onto the source (see `locateError`).
    expect(envelope.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'static-type-error',
      line: 2,
      column: 5,
      start: 14,
      end: 17,
    });
    // The message quotes the CALL that failed — here the whole statement,
    // since `x + "a"` is the call.
    expect(envelope.diagnostics[0].message).toContain('x + "a"');
  });

  test('reports one diagnostic per problem, not per cascade', async () => {
    // The error is embedded deep in a larger expression, and the same
    // mistake appears twice in the second statement.
    const { io, stdout } = makeIo();
    expect(
      await main(
        ['check', '-e', 'Sqrt("a") * 2 + 1\n"b" + 1 + "c"', '--json'],
        io
      )
    ).toBe(1);
    const { diagnostics } = JSON.parse(stdout());
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((x: { line: number }) => x.line)).toEqual([1, 2]);
  });

  test('checks a well-formed program clean', async () => {
    const { io, stdout, stderr } = makeIo();
    expect(
      await main(['check', '-e', 'f(n) = n^2 + 1\nf(3) + Sqrt(2)'], io)
    ).toBe(0);
    expect(stdout()).toBe('');
    expect(stderr()).toBe('');
  });

  test('checks an errors-as-values program clean', async () => {
    // `Error(…)` in the source is a value the program builds, not a
    // canonicalization failure — final, non-final and `let`-bound alike.
    for (const source of [
      'Error("boom")',
      'Error("boom")\n2',
      'let e = Error("boom")\ne',
      'let e = Error(ErrorCode("incompatible-type", "number", "string"))\ne',
    ]) {
      const { io, stdout } = makeIo();
      expect(await main(['check', '-e', source, '--json'], io)).toBe(0);
      const { diagnostics } = JSON.parse(stdout());
      expect(
        diagnostics.filter(
          (x: { code: string }) => x.code === 'static-type-error'
        )
      ).toEqual([]);
    }
  });

  test('labels a non-type canonicalization error as a static error', async () => {
    // The walk collects every canonicalization error, not only type errors:
    // the rendered label follows the code (the diagnostic *code* stays
    // `static-type-error`).
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', 'Sqrt(1, 2, 3)'], io)).toBe(1);
    expect(stderr()).toContain('Static error: unexpected argument');
  });

  test('keeps the readable form of a three-operand type error', async () => {
    // `ce.typeError()` mints `["Error", ["ErrorCode", code, expected, actual],
    // where]`: the `where` operand must not crowd out "expected X, got Y".
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', '1 |> 2'], io)).toBe(1);
    expect(stderr()).toContain(
      'Type error: expected `function`, got `finite_integer` for argument 2'
    );
  });

  test('skips the canonicalization pass when parsing failed', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['check', '-e', '1 +', '--json'], io)).toBe(1);
    const { diagnostics } = JSON.parse(stdout());
    expect(
      diagnostics.every((x: { code: string }) => x.code !== 'static-type-error')
    ).toBe(true);
  });

  test('does not execute the program it checks', async () => {
    // Nothing here may run: the loop is infinite, the draw would consume
    // randomness, and the `print` call would have to be applied. Boxing
    // canonicalizes all three without evaluating them.
    const source = [
      'let x = RandomInteger(1, 10)',
      'let i = 0',
      'while true { i = i + 1 }',
      'print("hi")',
      'x + i',
    ].join('\n');
    const { io } = makeIo();
    // Returning exit code 0 is the assertion: the source contains
    // `while true { ... }`, so a `check` that EVALUATED instead of only
    // canonicalizing would never return at all. The jest per-test timeout is
    // the backstop for that; elapsed milliseconds would measure the machine.
    expect(await main(['check', '-e', source], io)).toBe(0);
  });
});

describe('Epsil CLI doc command', () => {
  test('shows an exact entry, case-insensitively', async () => {
    for (const name of ['Sin', 'sin']) {
      const { io, stdout } = makeIo();
      expect(await main(['doc', name], io)).toBe(0);
      expect(stdout()).toContain('Sin (function)');
      expect(stdout()).toContain('->');
    }
  });

  test('searches by keywords', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['doc', 'greatest', 'common', 'divisor'], io)).toBe(0);
    expect(stdout()).toContain('GCD (function)');
  });

  test('emits structured JSON matches', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['doc', 'average', '--json'], io)).toBe(0);
    const { query, matches } = JSON.parse(stdout());
    expect(query).toBe('average');
    expect(matches.map((x: { id: string }) => x.id)).toContain('Mean');
    const mean = matches.find((x: { id: string }) => x.id === 'Mean');
    expect(mean.kind).toBe('function');
    expect(typeof mean.signature).toBe('string');
  });

  test('includes the value of constants', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['doc', 'Pi', '--json'], io)).toBe(0);
    const { matches } = JSON.parse(stdout());
    expect(matches[0]).toMatchObject({ id: 'Pi', kind: 'constant' });
    expect(matches[0].value).toContain('3.14159');
  });

  test('exits 1 when nothing matches', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['doc', 'zzzqqq'], io)).toBe(1);
    expect(stderr()).toContain('no documentation matches');
  });
});

describe('Epsil CLI JSON diagnostics for evaluation', () => {
  test('prints runtime diagnostics as JSON to stderr', async () => {
    const { io, stderr } = makeIo();
    expect(
      await main(
        ['-e', 'let xs = [1, 2, 3]\nxs[2] = 9\nxs', '--diagnostics', 'json'],
        io
      )
    ).toBe(1);
    const diagnostics = JSON.parse(stderr());
    // The static pass reports the statement first (it is rejected at
    // canonicalization time); the run reports it again. Both are kept.
    expect(diagnostics.map((x: { code: string }) => x.code)).toEqual([
      'static-type-error',
      'runtime-error',
    ]);
    expect(diagnostics[1]).toMatchObject({
      severity: 'error',
      code: 'runtime-error',
      line: 2,
    });
  });

  test('reports static type errors before evaluating, and still evaluates', async () => {
    const { io, stdout, stderr } = makeIo();
    // `"a" + 1` is a canonicalization-time type error; the program still runs
    // (errors are values), so the final statement's value is produced.
    expect(
      await main(['-e', '"a" + 1\n2', '--diagnostics', 'json', '--json'], io)
    ).toBe(1);
    const diagnostics = JSON.parse(stderr());
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'static-type-error',
      line: 1,
      column: 1,
    });
    // Accepted duplication: the same mistake also surfaces at run time
    // (the offending statement is not the final one).
    expect(diagnostics.map((x: { code: string }) => x.code)).toEqual([
      'static-type-error',
      'runtime-error',
    ]);
    // The CLI withholds the value when there are error diagnostics.
    expect(stdout()).toBe('');
  });

  test('a clean program gets no static diagnostics', async () => {
    const { io, stdout, stderr } = makeIo();
    expect(
      await main(['-e', 'let x = 5\nx + 1', '--diagnostics', 'json'], io)
    ).toBe(0);
    expect(stderr()).toBe('');
    expect(stdout()).toBe('6\n');
  });
});

describe('Epsil CLI runtime error reporting', () => {
  test('renders a final-statement error value as an annotated report', async () => {
    const { io, stdout, stderr } = makeIo();
    // The final statement's problem stays in `value` (no diagnostic, by
    // design — errors are values); the CLI renders it as an annotated block
    // on stderr instead of printing a raw `Error(…)` on stdout.
    expect(await main(['-e', 'const c = 1\nc = 2'], io)).toBe(1);
    expect(stdout()).toBe('');
    expect(stderr()).toContain('error: Runtime error:');
    expect(stderr()).toContain('--> 2:1');
    expect(stderr()).toContain('2 | c = 2');
    expect(stderr()).toContain('^^^^^');
  });

  test('anchors the report on the statement that produced the value', async () => {
    const { io, stderr } = makeIo();
    expect(
      await main(['-e', 'let s: string = "hi"\nLn(s, 2)'], io)
    ).toBe(1);
    // Since the static pre-pass applies declaration type effects
    // (`applyAssignmentTypeEffect`, 2026-08-18), `s: string` is known BEFORE
    // anything runs and the mismatch is a STATIC type error — it used to
    // surface only as `Runtime error:` when the statement executed. The
    // anchoring is unchanged: the offending `s` inside `Ln(s, 2)`, not the
    // statement.
    expect(stderr()).toContain('error: Type error: expected `number`');
    expect(stderr()).toContain('--> 2:4');
    expect(stderr()).toContain('2 | Ln(s, 2)');
  });

  test('machine output modes keep the error value on stdout', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['-e', 'const c = 1\nc = 2', '--json'], io)).toBe(1);
    expect(JSON.parse(stdout())[0]).toBe('Error');
  });

  test('renders a fixit as a help line', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', '(x) -> x^2'], io)).toBe(1);
    expect(stderr()).toContain('= help: did you mean `(x) => x^2`?');
  });

  test('advertises extended docs with a note footer', async () => {
    const { io, stderr } = makeIo();
    // The footer names the most SPECIFIC code with an entry — the engine's
    // `incompatible-type`, not the `runtime-error` wrapper.
    expect(await main(['-e', 'let s = ["a"]\nLength(Characters(s))'], io)).toBe(
      1
    );
    expect(stderr()).toContain(
      '= note: `epsil doc incompatible-type` explains this error'
    );
  });

  test('omits the note footer for codes without an entry', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', '1 +'], io)).toBe(1);
    expect(stderr()).not.toContain('= note:');
  });

  test('serves diagnostic-code documentation through `doc`', async () => {
    const { io, stdout } = makeIo();
    expect(await main(['doc', 'zero-index'], io)).toBe(0);
    expect(stdout()).toContain('zero-index (diagnostic)');
    expect(stdout()).toContain('Indexing is 1-based');

    // JSON mode carries the same explanation, machine-shaped.
    const json = makeIo();
    expect(await main(['doc', 'zero-index', '--json'], json.io)).toBe(0);
    expect(JSON.parse(json.stdout())).toMatchObject({ code: 'zero-index' });
  });

  test('narrows the span to the innermost source-mapped frame', async () => {
    const { io, stderr } = makeIo();
    // The error happens at the `s` inside `Characters(s)` — the report
    // points there, not at the whole statement. The breadcrumb chain is
    // data-only: the caret says it more clearly, so it is not rendered.
    expect(
      await main(
        ['-e', 'let s = ["a", "b"]\ns |> Map(_ => Length(Characters(s)), _)'],
        io
      )
    ).toBe(1);
    expect(stderr()).not.toContain('in Characters argument');
    expect(stderr()).toContain('--> 2:33');
    // A single-character span: one caret, not a statement-wide underline.
    expect(stderr()).toMatch(/\n\s*\| {33}\^\n/);
  });
});

describe('Epsil CLI signature error notes', () => {
  const FOO = 'function foo(x: string, n: integer) { x }\n';
  /** A report with its layout flattened away — notes are wrapped at a column,
   * so a sentence-level assertion must not depend on where the break fell. */
  const prose = (report: string) => report.replaceAll(/\s+/g, ' ');

  test('names the signature and the argument that was not supplied', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', `${FOO}foo("hello")`], io)).toBe(1);
    // The message alone ("a required argument is missing") does not say which
    // argument, or what `foo` takes.
    expect(prose(stderr())).toContain(
      '= note: `foo` has signature `(x: string, n: integer) -> string`; ' +
        'argument 2 (`n: integer`) was not supplied'
    );
  });

  test('wraps a long note without breaking a quoted type in half', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', `${FOO}foo("hello")`], io)).toBe(1);
    // Every line stays within the wrap column, and no line ends or starts
    // inside a backtick-quoted span (each line has an even number of them).
    for (const line of stderr().split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect([...line].filter((c) => c === '`').length % 2).toBe(0);
    }
  });

  test('points at the definition with a second annotated block', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', `${FOO}foo("hello")`], io)).toBe(1);
    expect(stderr()).toContain('note: `foo` is defined here');
    // Its own location line, and an excerpt underlining the NAME.
    expect(stderr()).toContain('--> 1:10');
    expect(stderr()).toContain('1 | function foo(x: string, n: integer) { x }');
    expect(stderr()).toMatch(/\n\s*\| {10}\^{3}\n/);
    // The extended-docs footer stays last: it is a footer for the report, not
    // for the definition block.
    expect(stderr().trimEnd()).toMatch(
      /= note: `epsil doc missing` explains this error$/
    );
  });

  test('reports the arity for an extra argument, and the parameter for a type mismatch', async () => {
    const extra = makeIo();
    expect(await main(['-e', `${FOO}foo("a", 1, 2)`], extra.io)).toBe(1);
    expect(prose(extra.stderr())).toContain(
      'it takes 2 arguments, so argument 3 is extra'
    );

    const mismatch = makeIo();
    expect(await main(['-e', `${FOO}foo(1, 2)`], mismatch.io)).toBe(1);
    expect(prose(mismatch.stderr())).toContain('argument 1 is `x: string`');
  });

  test('lists every arm of an overload set', async () => {
    const { io, stderr } = makeIo();
    expect(
      await main(
        ['-e', 'function fib(0) { 0 }\nfunction fib(n: integer) { n }\nfib()'],
        io
      )
    ).toBe(1);
    // The breadcrumb does not say which arm was being checked, so all of them
    // are shown — and the synthetic name of a literal-pattern parameter
    // (`literalParam_1`) is not, since the source never wrote it.
    expect(prose(stderr())).toContain('`fib` has 2 overloads: `(0) ->');
    expect(stderr()).not.toContain('literalParam');
  });

  test('explains a builtin, which has a signature but no definition site', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['-e', 'Ln()\n42'], io)).toBe(1);
    expect(stderr()).toContain(
      '`Ln` has signature `(number, base: number?) -> number`'
    );
    expect(stderr()).not.toContain('is defined here');
  });

  test('stays silent when the signature explains nothing', async () => {
    const { io, stderr } = makeIo();
    // `"a" + 1` faults inside `Add`, whose signature is the fully variadic
    // `(value+) -> value`: a note would name an operator the source spells
    // `+` and then explain nothing about it.
    expect(await main(['-e', '"a" + 1\n2'], io)).toBe(1);
    expect(stderr()).not.toContain('has signature');
  });

  test('carries the notes, and the definition location, into JSON diagnostics', async () => {
    const { io, stderr } = makeIo();
    expect(
      await main(['-e', `${FOO}foo("hello")\n42`, '--diagnostics', 'json'], io)
    ).toBe(1);
    const runtime = JSON.parse(stderr()).find(
      (x: { code: string }) => x.code === 'runtime-error'
    );
    expect(runtime.notes[0].message).toContain('has signature');
    // A note pointing at a second place carries that place, machine-readable.
    expect(runtime.notes[1]).toMatchObject({
      message: '`foo` is defined here',
      line: 1,
      column: 10,
    });
    // A prose note carries no location.
    expect(runtime.notes[0].line).toBeUndefined();
  });

  test('underlines the argument, not the definition that contains it', async () => {
    const { io, stdout } = makeIo();
    const source = [
      'const digits = "0123456789"',
      'function parseDigits(cs, i, acc) {',
      '  if i <= Length(cs) {',
      '    parseDigits(cs, i + 1, IndexOf(digits, cs[i], 23))',
      '  } else { (acc, i) }',
      '}',
    ].join('\n');
    expect(await main(['check', '-e', source, '--json'], io)).toBe(1);
    const [diagnostic] = JSON.parse(stdout()).diagnostics;

    // The extra argument is `23`, four lines into a function definition.
    // Anchoring on the statement would underline the whole definition.
    expect(source.slice(diagnostic.start, diagnostic.end)).toBe('23');
    expect(diagnostic.line).toBe(4);
    // And the message quotes the CALL that failed, not the definition —
    // which is all a host that shows only the message (an editor hover) has.
    expect(diagnostic.message).toBe(
      'Static error: unexpected argument in `IndexOf(digits, cs[i], 23)`'
    );
  });

  test('checks calls to a function the program itself defines', async () => {
    const { io, stdout } = makeIo();
    // Nothing is evaluated, so this works only because `DefineFunction`
    // installs its clause when it CANONICALIZES: without that the target
    // keeps the top `function` type, which promises no arity, and the call
    // type-checks vacuously.
    const source = 'function foo(x: string, n: integer) { x }\nfoo("hello")';
    expect(await main(['check', '-e', source, '--json'], io)).toBe(1);
    const [diagnostic] = JSON.parse(stdout()).diagnostics;
    expect(diagnostic.message).toContain('a required argument is missing');
    // And the definition site is reachable from a static diagnostic, which is
    // what makes the "defined here" note appear in an editor.
    expect(diagnostic.notes[1]).toMatchObject({
      message: '`foo` is defined here',
      line: 1,
    });
  });

  test('a multi-clause definition checks against every clause', async () => {
    const { io, stdout, stderr } = makeIo();
    // Each clause installs as it canonicalizes, so the accumulated overload
    // set — not just the first clause — is what a later call is checked
    // against. `fib(10)` matches the third clause and must pass clean.
    expect(
      await main(
        [
          'check',
          '-e',
          'function fib(0) { 0 }\nfunction fib(1) { 1 }\nfunction fib(n: integer) { fib(n-1) + fib(n-2) }\nfib(10)',
        ],
        io
      )
    ).toBe(0);
    expect(stdout()).toBe('');
    expect(stderr()).toBe('');
  });

  test('a definition inside a block does not check calls outside it', async () => {
    const { io, stdout } = makeIo();
    // The definition is scoped to the branch, so the outer `f` is unknown and
    // stays unchecked. Reporting against either branch's signature would be a
    // false positive — the pass is incomplete rather than unsound.
    expect(
      await main(
        [
          'check',
          '-e',
          'if true { function f(x: integer) { x } } else { function f(x: integer, y: integer) { x } }\nf(1)',
          '--json',
        ],
        io
      )
    ).toBe(0);
    expect(JSON.parse(stdout()).diagnostics).toEqual([]);
  });

  test('a generic definition is left unchecked rather than checked wrongly', async () => {
    const { io, stdout } = makeIo();
    // Generic clauses are excluded from the canonicalization-time install
    // (rule G2 makes it non-repeatable), so `id(5)` is simply not checked
    // here. What matters is that nothing is reported: a skipped install must
    // not leave a half-built signature behind.
    expect(
      await main(
        ['check', '-e', 'function id<T>(x: T) -> T { x }\nid(5)', '--json'],
        io
      )
    ).toBe(0);
    expect(JSON.parse(stdout()).diagnostics).toEqual([]);
  });

  test('explains a static-pass signature error too', async () => {
    const { io, stdout } = makeIo();
    // `epsil check` never evaluates, so the note has to come from the
    // canonicalization pass — where the error carries no breadcrumb and its
    // position in the canonical tree names the callee instead.
    expect(await main(['check', '-e', 'Ln()', '--json'], io)).toBe(1);
    expect(JSON.parse(stdout()).diagnostics[0].notes[0].message).toContain(
      '`Ln` has signature'
    );
  });
});

describe('Epsil CLI evaluation', () => {
  test('keeps declarations in one session and resets them on request', () => {
    const session = makeEpsilSession(0);
    expect(session.evaluate('let x = 5').value.toString()).toBe('5');
    expect(session.evaluate('x^2').value.toString()).toBe('25');

    session.reset();
    expect(session.evaluate('x^2').value.toString()).toBe('x^2');
  });

  test('formats values in value, Epsil, and MathJSON modes', () => {
    const result = makeEpsilSession(0).evaluate('1/2 + 1');
    expect(formatValue(result, 'value')).toBe('3/2');
    expect(formatValue(result, 'epsil')).toBe('3 / 2');
    expect(JSON.parse(formatValue(result, 'json'))).toEqual(['Rational', 3, 2]);
  });

  test('JSON output materializes finite lazy collections', () => {
    const session = makeEpsilSession(0);
    expect(
      JSON.parse(formatValue(session.evaluate('Range(1, 15)'), 'json'))
    ).toEqual(['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(
      JSON.parse(
        formatValue(
          session.evaluate(
            'let xs = []\nfor k in 1..12 { xs = Join(xs, [k]) }\nxs'
          ),
          'json'
        )
      )
    ).toEqual(['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Materialization descends into containers.
    expect(
      JSON.parse(
        formatValue(
          session.evaluate('([10,20,30,40] |> Take(_, 3), 1)'),
          'json'
        )
      )
    ).toEqual(['Pair', ['List', 10, 20, 30], 1]);
    // An infinite collection keeps its structural form.
    expect(
      JSON.parse(formatValue(session.evaluate('Range(1, Infinity)'), 'json'))
    ).toEqual(['Range', 1, 'PositiveInfinity']);
  });

  test('formats diagnostics with a location and source excerpt', () => {
    const result = makeEpsilSession(0).evaluate('1 +');
    const output = formatDiagnostics(
      result.diagnostics,
      result.source,
      'example.epsil',
      false
    );
    expect(output).toContain('error: Unexpected symbol "+"');
    expect(output).toContain('--> example.epsil:1:3');
    expect(output).toContain('1 | 1 +');
    expect(hasErrors(result)).toBe(true);
  });
});

describe('Epsil CLI multiline input', () => {
  const session = makeEpsilSession(0);

  test.each(['if (true) {', '[1, 2', '"unfinished', '1 +'])(
    'treats %p as recoverable',
    (source) => {
      expect(isRecoverable(source, session.parse(source))).toBe(true);
    }
  );

  test('does not continue after an ordinary syntax error', () => {
    const source = '1 @ 2';
    expect(isRecoverable(source, session.parse(source))).toBe(false);
  });
});
