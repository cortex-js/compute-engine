import { parseTypePrefix, parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// `parseTypePrefix` parses a type from the START of a string and reports how
// far it consumed, without requiring EOF and without its "did you mean" error
// heuristics reading past the consumed range. It is the entry point used by the
// Cortex parser for type annotations (`x: real = 5`).
//

describe('parseTypePrefix', () => {
  test('a bare type consumes the whole string', () => {
    const { type, end } = parseTypePrefix('real');
    expect(typeToString(type)).toBe('real');
    expect(end).toBe(4);
  });

  test('a type followed by ` = 5` stops just past the type', () => {
    const source = 'real = 5';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('real');
    // The space and `=` are NOT consumed.
    expect(end).toBe(4);
    expect(source.slice(0, end)).toBe('real');
  });

  test('a generic type followed by trailing text', () => {
    const source = 'list<integer>, y';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('list<integer>');
    expect(end).toBe('list<integer>'.length);
    expect(source.slice(0, end)).toBe('list<integer>');
  });

  test('a bounded numeric type followed by trailing source', () => {
    const source = 'integer<0..10> rest';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('integer<0..10>');
    expect(source.slice(0, end)).toBe('integer<0..10>');
  });

  test('a parenthesized function signature followed by ` = 3`', () => {
    const source = '(real) -> real = 3';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('(real) -> real');
    expect(source.slice(0, end)).toBe('(real) -> real');
  });

  test('an invalid type throws, carrying an offset position', () => {
    expect(() => parseTypePrefix('notatype = 5')).toThrow();
    try {
      parseTypePrefix('notatype = 5');
      throw new Error('should have thrown');
    } catch (e) {
      // The offending token is at offset 0; the trailing ` = 5` did not leak
      // into the message.
      expect((e as { position?: number }).position).toBe(0);
      expect((e as { rawMessage?: string }).rawMessage).toContain('notatype');
      expect((e as Error).message).not.toContain('= 5');
    }
  });

  test('the "did you mean" heuristic does not read trailing source', () => {
    // Trailing `set(` in the surrounding source must not surface as a type
    // suggestion: `set` parses as a bare primitive type and parsing stops.
    const { type, end } = parseTypePrefix('set, xs = set(1)');
    expect(typeToString(type)).toBe('set');
    expect(end).toBe(3);
  });

  test('parseType is unchanged (still requires the whole string)', () => {
    expect(typeToString(parseType('real'))).toBe('real');
    expect(() => parseType('real = 5')).toThrow();
  });
});
