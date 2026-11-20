import { ComputeEngine, checkEpsil, epsilDiagnosticMessage } from '../../src/epsil';

// `epsilDiagnosticMessage` gives the text of a diagnostic for display: the
// sentence of its message tuple, without the code.

const messages = (source: string) =>
  checkEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
    epsilDiagnosticMessage(d)
  );

describe('epsilDiagnosticMessage', () => {
  test('a type annotation error is the sentence of the type parser', () => {
    expect(messages('let x: notatype = 1')).toEqual([
      'Unknown type "notatype"',
    ]);
  });

  test('a missing type is "Expected a type"', () => {
    expect(messages('let x: = 1')).toContain('Expected a type');
  });

  test('a syntax error is a sentence', () => {
    expect(messages('foo(1')).toEqual(['Expected closing bracket ")"']);
    expect(messages('let s = "abc')).toEqual([
      'Expected closing string delimiter "\\""',
    ]);
  });

  test('a static type error has its label and the source', () => {
    expect(messages('let x: real = "a"')).toEqual([
      'Type error: The value ""a"" of type "string" is not compatible with the declared type "real" in `let x: real = "a"`',
    ]);
  });

  test('no text starts with the code of the diagnostic', () => {
    for (const source of ['let x: notatype = 1', 'let x: = 1', 'foo(1']) {
      const ce = new ComputeEngine();
      for (const d of checkEpsil(ce, source).diagnostics) {
        const code = Array.isArray(d.message) ? d.message[0] : d.message;
        const text = epsilDiagnosticMessage(d);
        expect(text.startsWith(code)).toBe(false);
        expect(text.startsWith(code.replaceAll('-', ' '))).toBe(false);
      }
    }
  });
});
