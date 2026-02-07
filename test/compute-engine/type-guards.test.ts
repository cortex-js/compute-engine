import { engine } from '../utils';
import {
  isBoxedExpression,
  isBoxedNumber,
  isBoxedSymbol,
  isBoxedFunction,
  isBoxedString,
  isBoxedTensor,
  isDictionary,
} from '../../src/compute-engine';

const ce = engine;

describe('isBoxedExpression', () => {
  test('returns true for any boxed expression', () => {
    expect(isBoxedExpression(ce.box(42))).toBe(true);
    expect(isBoxedExpression(ce.box('x'))).toBe(true);
    expect(isBoxedExpression(ce.parse('x + 1'))).toBe(true);
  });

  test('returns false for non-expressions', () => {
    expect(isBoxedExpression(null)).toBe(false);
    expect(isBoxedExpression(undefined)).toBe(false);
    expect(isBoxedExpression(42)).toBe(false);
    expect(isBoxedExpression('x')).toBe(false);
    expect(isBoxedExpression({})).toBe(false);
  });
});

describe('isBoxedNumber', () => {
  test('returns true for numbers', () => {
    expect(isBoxedNumber(ce.box(42))).toBe(true);
    expect(isBoxedNumber(ce.box(3.14))).toBe(true);
    expect(isBoxedNumber(ce.box(['Complex', 1, 2]))).toBe(true);
  });

  test('returns false for non-numbers', () => {
    expect(isBoxedNumber(ce.box('x'))).toBe(false);
    expect(isBoxedNumber(ce.parse('x + 1'))).toBe(false);
    expect(isBoxedNumber(null)).toBe(false);
    expect(isBoxedNumber(undefined)).toBe(false);
  });

  test('narrows type to BoxedNumber', () => {
    const expr = ce.box(42);
    if (isBoxedNumber(expr)) {
      // After guard, numericValue should be accessible and non-null
      expect(expr.numericValue).not.toBeNull();
    }
  });
});

describe('isBoxedSymbol', () => {
  test('returns true for symbols', () => {
    expect(isBoxedSymbol(ce.box('x'))).toBe(true);
    expect(isBoxedSymbol(ce.box('Pi'))).toBe(true);
  });

  test('returns false for non-symbols', () => {
    expect(isBoxedSymbol(ce.box(42))).toBe(false);
    expect(isBoxedSymbol(ce.parse('x + 1'))).toBe(false);
    expect(isBoxedSymbol(null)).toBe(false);
    expect(isBoxedSymbol(undefined)).toBe(false);
  });

  test('narrows type to BoxedSymbol', () => {
    const expr = ce.box('x');
    if (isBoxedSymbol(expr)) {
      expect(expr.symbol).toBe('x');
    }
  });
});

describe('isBoxedFunction', () => {
  test('returns true for function expressions', () => {
    expect(isBoxedFunction(ce.parse('x + 1'))).toBe(true);
    expect(isBoxedFunction(ce.parse('\\sin(x)'))).toBe(true);
  });

  test('returns false for non-functions', () => {
    expect(isBoxedFunction(ce.box(42))).toBe(false);
    expect(isBoxedFunction(ce.box('x'))).toBe(false);
    expect(isBoxedFunction(null)).toBe(false);
    expect(isBoxedFunction(undefined)).toBe(false);
  });

  test('narrows type to BoxedFunction', () => {
    const expr = ce.parse('x + 1');
    if (isBoxedFunction(expr)) {
      expect(expr.ops).toBeDefined();
      expect(expr.operator).toBeDefined();
    }
  });
});

describe('isBoxedString', () => {
  test('returns true for strings', () => {
    expect(isBoxedString(ce.box({ str: 'hello' }))).toBe(true);
  });

  test('returns false for non-strings', () => {
    expect(isBoxedString(ce.box(42))).toBe(false);
    expect(isBoxedString(ce.box('x'))).toBe(false);
    expect(isBoxedString(null)).toBe(false);
    expect(isBoxedString(undefined)).toBe(false);
  });

  test('narrows type to BoxedString', () => {
    const expr = ce.box({ str: 'hello' });
    if (isBoxedString(expr)) {
      expect(expr.string).toBe('hello');
    }
  });
});

describe('isBoxedTensor', () => {
  test('returns true for tensors', () => {
    expect(isBoxedTensor(ce.box(['List', 1, 2, 3]))).toBe(true);
  });

  test('returns false for non-tensors', () => {
    expect(isBoxedTensor(ce.box(42))).toBe(false);
    expect(isBoxedTensor(ce.box('x'))).toBe(false);
    expect(isBoxedTensor(null)).toBe(false);
    expect(isBoxedTensor(undefined)).toBe(false);
  });
});

describe('isDictionary', () => {
  test('returns true for dictionaries', () => {
    const expr = ce.box([
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
    ]);
    expect(isDictionary(expr)).toBe(true);
  });

  test('returns false for non-dictionaries', () => {
    expect(isDictionary(ce.box(42))).toBe(false);
    expect(isDictionary(ce.box('x'))).toBe(false);
    expect(isDictionary(null)).toBe(false);
    expect(isDictionary(undefined)).toBe(false);
  });

  test('narrows type to include DictionaryInterface', () => {
    const expr = ce.box([
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
    ]);
    if (isDictionary(expr)) {
      expect(expr.has('a')).toBe(true);
      expect(expr.keys).toBeDefined();
    }
  });
});
