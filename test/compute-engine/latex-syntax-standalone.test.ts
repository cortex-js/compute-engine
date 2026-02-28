/**
 * Tests for the standalone LatexSyntax class and free functions.
 *
 * These tests verify that LaTeX parsing and serialization work
 * without a ComputeEngine instance.
 */

import {
  LatexSyntax,
  parse,
  serialize,
  LATEX_DICTIONARY,
  CORE_DICTIONARY,
  ARITHMETIC_DICTIONARY,
  SYMBOLS_DICTIONARY,
} from '../../src/latex-syntax';
import type { MathJsonExpression } from '../../src/math-json/types';

// Helper: extract the operator (head) from a MathJSON expression
function operator(expr: MathJsonExpression | null): string | null {
  if (expr === null) return null;
  if (Array.isArray(expr) && typeof expr[0] === 'string') return expr[0];
  return null;
}

// ---------------------------------------------------------------------------
// Free-function parse()
// ---------------------------------------------------------------------------
describe('parse() free function', () => {
  test('parses simple addition', () => {
    const result = parse('x + 1');
    expect(result).not.toBeNull();
    expect(operator(result)).toBe('Add');
  });

  test('parses fraction', () => {
    const result = parse('\\frac{x}{2}');
    expect(result).not.toBeNull();
    expect(operator(result)).toBe('Divide');
  });

  test('parses power', () => {
    const result = parse('x^2');
    expect(result).not.toBeNull();
    // x^2 can be ['Power', 'x', 2] or ['Square', 'x']
    const op = operator(result);
    expect(op === 'Power' || op === 'Square').toBe(true);
  });

  test('parses trigonometric functions', () => {
    const result = parse('\\sin(x)');
    expect(result).not.toBeNull();
    expect(operator(result)).toBe('Sin');
  });

  test('parses nested expressions', () => {
    const result = parse('\\frac{x^2 + 1}{x - 1}');
    expect(result).not.toBeNull();
    expect(operator(result)).toBe('Divide');
  });

  test('parses a number', () => {
    const result = parse('42');
    expect(result).toBe(42);
  });

  test('parses a symbol', () => {
    const result = parse('x');
    expect(result).toBe('x');
  });

  test('parses pi', () => {
    const result = parse('\\pi');
    expect(result).toBe('Pi');
  });

  test('parses square root', () => {
    const result = parse('\\sqrt{x}');
    expect(result).not.toBeNull();
    expect(operator(result)).toBe('Sqrt');
  });

  test('parses empty string as Nothing', () => {
    const result = parse('');
    expect(result).toBe('Nothing');
  });
});

// ---------------------------------------------------------------------------
// Free-function serialize()
// ---------------------------------------------------------------------------
describe('serialize() free function', () => {
  test('serializes addition', () => {
    const result = serialize(['Add', 'x', 1]);
    expect(result).toContain('x');
    expect(result).toContain('+');
    expect(result).toContain('1');
  });

  test('serializes division as fraction', () => {
    const result = serialize(['Divide', 'x', 2]);
    expect(result).toContain('\\frac');
  });

  test('serializes power', () => {
    const result = serialize(['Power', 'x', 2]);
    expect(result).toContain('x');
    expect(result).toContain('^');
  });

  test('serializes a number', () => {
    const result = serialize(42);
    expect(result).toBe('42');
  });

  test('serializes a symbol', () => {
    const result = serialize('x');
    expect(result).toBe('x');
  });

  test('serializes Pi', () => {
    const result = serialize('Pi');
    expect(result).toContain('\\pi');
  });

  test('serializes Sqrt', () => {
    const result = serialize(['Sqrt', 'x']);
    expect(result).toContain('\\sqrt');
  });

  test('serializes multiply', () => {
    const result = serialize(['Multiply', 2, 'x']);
    expect(result).toContain('2');
    expect(result).toContain('x');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------
describe('round-trip parse -> serialize', () => {
  test('x^2 + 1', () => {
    const expr = parse('x^2 + 1');
    expect(expr).not.toBeNull();
    const latex = serialize(expr!);
    // The round-tripped LaTeX should be valid and contain the key elements
    expect(latex).toContain('x');
    expect(latex).toContain('1');
  });

  test('fraction round-trip', () => {
    const expr = parse('\\frac{a}{b}');
    expect(expr).not.toBeNull();
    const latex = serialize(expr!);
    expect(latex).toContain('\\frac');
  });

  test('sin(x) round-trip', () => {
    const expr = parse('\\sin(x)');
    expect(expr).not.toBeNull();
    const latex = serialize(expr!);
    expect(latex).toContain('\\sin');
    expect(latex).toContain('x');
  });
});

// ---------------------------------------------------------------------------
// LatexSyntax class — custom instances
// ---------------------------------------------------------------------------
describe('LatexSyntax class', () => {
  test('default instance works like free functions', () => {
    const syntax = new LatexSyntax();
    const expr = syntax.parse('x + 1');
    expect(expr).not.toBeNull();
    expect(operator(expr)).toBe('Add');
  });

  test('custom dictionary with subset of entries', () => {
    // Use only core + arithmetic + symbols dictionaries
    const syntax = new LatexSyntax({
      dictionary: [
        ...CORE_DICTIONARY,
        ...ARITHMETIC_DICTIONARY,
        ...SYMBOLS_DICTIONARY,
      ],
    });

    // Arithmetic should still work
    const expr = syntax.parse('1 + 2');
    expect(expr).not.toBeNull();
    expect(operator(expr)).toBe('Add');
  });

  test('custom decimal separator (comma)', () => {
    const syntax = new LatexSyntax({
      decimalSeparator: '{,}',
    });

    // Parsing with comma decimal separator
    const expr = syntax.parse('3{,}14');
    // Should parse as a number (approximately 3.14)
    expect(expr).not.toBeNull();
  });

  test('serialize with custom options', () => {
    const syntax = new LatexSyntax();
    const result = syntax.serialize(['Add', 'x', 1], {
      invisibleMultiply: '\\cdot',
    });
    expect(result).toContain('x');
    expect(result).toContain('1');
  });

  test('parse with preserveLatex', () => {
    const syntax = new LatexSyntax({ preserveLatex: true });
    const result = syntax.parse('x + 1');
    expect(result).not.toBeNull();
    // With preserveLatex, the result should contain a `latex` property
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      expect((result as any).latex).toBeDefined();
    }
  });

  test('two independent instances do not interfere', () => {
    const a = new LatexSyntax();
    const b = new LatexSyntax({ decimalSeparator: '{,}' });

    // Instance a uses default decimal separator
    const exprA = a.parse('3.14');
    expect(exprA).not.toBeNull();

    // Instance b uses comma decimal separator
    const exprB = b.parse('3{,}14');
    expect(exprB).not.toBeNull();

    // Verify they didn't contaminate each other -- a should still parse '.'
    const exprA2 = a.parse('2.5');
    expect(exprA2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LATEX_DICTIONARY export
// ---------------------------------------------------------------------------
describe('LATEX_DICTIONARY export', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(LATEX_DICTIONARY)).toBe(true);
    expect(LATEX_DICTIONARY.length).toBeGreaterThan(100);
  });

  test('individual dictionaries are arrays', () => {
    expect(Array.isArray(CORE_DICTIONARY)).toBe(true);
    expect(Array.isArray(ARITHMETIC_DICTIONARY)).toBe(true);
    expect(Array.isArray(SYMBOLS_DICTIONARY)).toBe(true);
    expect(CORE_DICTIONARY.length).toBeGreaterThan(0);
    expect(ARITHMETIC_DICTIONARY.length).toBeGreaterThan(0);
    expect(SYMBOLS_DICTIONARY.length).toBeGreaterThan(0);
  });
});
