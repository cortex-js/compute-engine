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
import { makeCortexSession } from '../../src/cli/session';

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

describe('Cortex CLI arguments', () => {
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
    expect(() => parseCliArguments(['-e', '1', 'program.cx'])).toThrow(
      CliUsageError
    );
    expect(() => parseCliArguments(['--json', '--cortex'])).toThrow(
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
    expect(() => parseCheckArguments(['-e', '1', 'a.cx'], {})).toThrow(
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

describe('Cortex CLI check command', () => {
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

describe('Cortex CLI check: canonicalization-time type errors', () => {
  test('reports a static type error, anchored to its statement', async () => {
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', '"a" + 1'], io)).toBe(1);
    expect(stderr()).toContain(
      '1:1 error: Type error: incompatible-type (expected number, got string) in `"a" + 1`'
    );
  });

  test('anchors to the offending statement of a multi-statement program', async () => {
    const { io, stdout } = makeIo();
    expect(
      await main(['check', '-e', 'let x = 5\nx + "a"', '--json'], io)
    ).toBe(1);
    const envelope = JSON.parse(stdout());
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics).toHaveLength(1);
    expect(envelope.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'static-type-error',
      line: 2,
      column: 1,
      start: 10,
      end: 17,
    });
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
    expect(stderr()).toContain('Static error: unexpected-argument');
  });

  test('keeps the readable form of a three-operand type error', async () => {
    // `ce.typeError()` mints `["Error", ["ErrorCode", code, expected, actual],
    // where]`: the `where` operand must not crowd out "expected X, got Y".
    const { io, stderr } = makeIo();
    expect(await main(['check', '-e', '1 |> 2'], io)).toBe(1);
    expect(stderr()).toContain(
      'Type error: incompatible-type (expected function, got finite_integer; at 2)'
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
    const start = Date.now();
    expect(await main(['check', '-e', source], io)).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('Cortex CLI doc command', () => {
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

describe('Cortex CLI JSON diagnostics for evaluation', () => {
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

describe('Cortex CLI evaluation', () => {
  test('keeps declarations in one session and resets them on request', () => {
    const session = makeCortexSession(0);
    expect(session.evaluate('let x = 5').value.toString()).toBe('5');
    expect(session.evaluate('x^2').value.toString()).toBe('25');

    session.reset();
    expect(session.evaluate('x^2').value.toString()).toBe('x^2');
  });

  test('formats values in value, Cortex, and MathJSON modes', () => {
    const result = makeCortexSession(0).evaluate('1/2 + 1');
    expect(formatValue(result, 'value')).toBe('3/2');
    expect(formatValue(result, 'cortex')).toBe('3 / 2');
    expect(JSON.parse(formatValue(result, 'json'))).toEqual(['Rational', 3, 2]);
  });

  test('JSON output materializes finite lazy collections', () => {
    const session = makeCortexSession(0);
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
    const result = makeCortexSession(0).evaluate('1 +');
    const output = formatDiagnostics(
      result.diagnostics,
      result.source,
      'example.cx',
      false
    );
    expect(output).toContain('example.cx:1:4 error');
    expect(output).toContain('Unexpected symbol "+"');
    expect(output).toContain('1 | 1 +');
    expect(hasErrors(result)).toBe(true);
  });
});

describe('Cortex CLI multiline input', () => {
  const session = makeCortexSession(0);

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
