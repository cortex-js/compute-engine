import { parseCliArguments, CliUsageError } from '../../src/cli/arguments';
import {
  formatDiagnostics,
  formatValue,
  hasErrors,
} from '../../src/cli/format';
import { isRecoverable } from '../../src/cli/repl';
import { makeCortexSession } from '../../src/cli/session';

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
