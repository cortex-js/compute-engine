import { engine } from '../utils';
import {
  isBoxedExpression,
  isBoxedNumber,
  isBoxedSymbol,
  isBoxedFunction,
  isBoxedString,
  isBoxedTensor,
  isDictionary,
  isCollection,
  isIndexedCollection,
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

  test('narrows type to NumberLiteralInterface', () => {
    const expr = ce.box(42);
    if (isBoxedNumber(expr)) {
      // After guard, numericValue is number | NumericValue (no undefined)
      expect(expr.numericValue).not.toBeUndefined();
      expect(expr.isNumberLiteral).toBe(true);
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

  test('narrows type to SymbolInterface', () => {
    const expr = ce.box('x');
    if (isBoxedSymbol(expr)) {
      // After guard, symbol is string (no undefined)
      const name: string = expr.symbol;
      expect(name).toBe('x');
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

  test('narrows type to FunctionInterface', () => {
    const expr = ce.parse('x + 1');
    if (isBoxedFunction(expr)) {
      // After guard, ops is ReadonlyArray<BoxedExpression> (no undefined)
      expect(expr.ops.length).toBeGreaterThan(0);
      expect(expr.nops).toBeGreaterThan(0);
      expect(expr.isFunctionExpression).toBe(true);
      expect(expr.op1).toBeDefined();
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

  test('narrows type to StringInterface', () => {
    const expr = ce.box({ str: 'hello' });
    if (isBoxedString(expr)) {
      // After guard, string is string (no undefined)
      const val: string = expr.string;
      expect(val).toBe('hello');
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

  test('narrows type to TensorInterface', () => {
    const expr = ce.box(['List', 1, 2, 3]);
    if (isBoxedTensor(expr)) {
      // After guard, tensor is Tensor<any> (no undefined)
      expect(expr.tensor).toBeDefined();
      expect(expr.shape).toEqual([3]);
      expect(expr.rank).toBe(1);
    }
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

describe('isCollection', () => {
  test('returns true for collections (lists)', () => {
    const list = ce.box(['List', 1, 2, 3]);
    expect(isCollection(list)).toBe(true);
  });

  test('returns true for Range (lazy collection)', () => {
    const range = ce.box(['Range', 1, 10]);
    expect(isCollection(range)).toBe(true);
  });

  test('returns false for non-collections', () => {
    expect(isCollection(ce.box(42))).toBe(false);
    expect(isCollection(ce.box('x'))).toBe(false);
    expect(isCollection(null)).toBe(false);
    expect(isCollection(undefined)).toBe(false);
  });

  test('narrows type to CollectionInterface', () => {
    const list = ce.box(['List', 1, 2, 3]);
    if (isCollection(list)) {
      expect(list.isCollection).toBe(true);
      // each() returns a generator
      const items = [...list.each()];
      expect(items.length).toBe(3);
    }
  });
});

describe('isIndexedCollection', () => {
  test('returns true for indexed collections (lists)', () => {
    const list = ce.box(['List', 1, 2, 3]);
    expect(isIndexedCollection(list)).toBe(true);
  });

  test('returns false for non-indexed collections', () => {
    expect(isIndexedCollection(ce.box(42))).toBe(false);
    expect(isIndexedCollection(ce.box('x'))).toBe(false);
    expect(isIndexedCollection(null)).toBe(false);
    expect(isIndexedCollection(undefined)).toBe(false);
  });

  test('narrows type to IndexedCollectionInterface', () => {
    const list = ce.box(['List', 1, 2, 3]);
    if (isIndexedCollection(list)) {
      expect(list.isIndexedCollection).toBe(true);
      // at() is available
      const first = list.at(1);
      expect(first).toBeDefined();
      expect(first!.re).toBe(1);
    }
  });
});
