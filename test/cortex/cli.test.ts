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
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'runtime-error',
      line: 2,
    });
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
