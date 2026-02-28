import { engine } from '../utils';
import {
  isExpression,
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isTensor,
  isDictionary,
  isCollection,
  isIndexedCollection,
} from '../../src/compute-engine';

const ce = engine;

describe('isExpression', () => {
  test('returns true for any boxed expression', () => {
    expect(isExpression(ce.expr(42))).toBe(true);
    expect(isExpression(ce.expr('x'))).toBe(true);
    expect(isExpression(ce.parse('x + 1'))).toBe(true);
  });

  test('returns false for non-expressions', () => {
    expect(isExpression(null)).toBe(false);
    expect(isExpression(undefined)).toBe(false);
    expect(isExpression(42)).toBe(false);
    expect(isExpression('x')).toBe(false);
    expect(isExpression({})).toBe(false);
  });
});

describe('isNumber', () => {
  test('returns true for numbers', () => {
    expect(isNumber(ce.expr(42))).toBe(true);
    expect(isNumber(ce.expr(3.14))).toBe(true);
    expect(isNumber(ce.expr(['Complex', 1, 2]))).toBe(true);
  });

  test('returns false for non-numbers', () => {
    expect(isNumber(ce.expr('x'))).toBe(false);
    expect(isNumber(ce.parse('x + 1'))).toBe(false);
    expect(isNumber(null)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
  });

  test('narrows type to NumberLiteralInterface', () => {
    const expr = ce.expr(42);
    if (isNumber(expr)) {
      // After guard, numericValue is number | NumericValue (no undefined)
      expect(expr.numericValue).not.toBeUndefined();
      expect(expr.isNumberLiteral).toBe(true);
    }
  });
});

describe('isSymbol', () => {
  test('returns true for symbols', () => {
    expect(isSymbol(ce.expr('x'))).toBe(true);
    expect(isSymbol(ce.expr('Pi'))).toBe(true);
  });

  test('returns false for non-symbols', () => {
    expect(isSymbol(ce.expr(42))).toBe(false);
    expect(isSymbol(ce.parse('x + 1'))).toBe(false);
    expect(isSymbol(null)).toBe(false);
    expect(isSymbol(undefined)).toBe(false);
  });

  test('narrows type to SymbolInterface', () => {
    const expr = ce.expr('x');
    if (isSymbol(expr)) {
      // After guard, symbol is string (no undefined)
      const name: string = expr.symbol;
      expect(name).toBe('x');
    }
  });
});

describe('isFunction', () => {
  test('returns true for function expressions', () => {
    expect(isFunction(ce.parse('x + 1'))).toBe(true);
    expect(isFunction(ce.parse('\\sin(x)'))).toBe(true);
  });

  test('returns false for non-functions', () => {
    expect(isFunction(ce.expr(42))).toBe(false);
    expect(isFunction(ce.expr('x'))).toBe(false);
    expect(isFunction(null)).toBe(false);
    expect(isFunction(undefined)).toBe(false);
  });

  test('narrows type to FunctionInterface', () => {
    const expr = ce.parse('x + 1');
    if (isFunction(expr)) {
      // After guard, ops is ReadonlyArray<Expression> (no undefined)
      expect(expr.ops.length).toBeGreaterThan(0);
      expect(expr.nops).toBeGreaterThan(0);
      expect(expr.isFunctionExpression).toBe(true);
      expect(expr.op1).toBeDefined();
    }
  });
});

describe('isString', () => {
  test('returns true for strings', () => {
    expect(isString(ce.expr({ str: 'hello' }))).toBe(true);
  });

  test('returns false for non-strings', () => {
    expect(isString(ce.expr(42))).toBe(false);
    expect(isString(ce.expr('x'))).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });

  test('narrows type to StringInterface', () => {
    const expr = ce.expr({ str: 'hello' });
    if (isString(expr)) {
      // After guard, string is string (no undefined)
      const val: string = expr.string;
      expect(val).toBe('hello');
    }
  });
});

describe('isTensor', () => {
  test('returns true for tensors', () => {
    expect(isTensor(ce.expr(['List', 1, 2, 3]))).toBe(true);
  });

  test('returns false for non-tensors', () => {
    expect(isTensor(ce.expr(42))).toBe(false);
    expect(isTensor(ce.expr('x'))).toBe(false);
    expect(isTensor(null)).toBe(false);
    expect(isTensor(undefined)).toBe(false);
  });

  test('narrows type to TensorInterface', () => {
    const expr = ce.expr(['List', 1, 2, 3]);
    if (isTensor(expr)) {
      // After guard, tensor is Tensor<any> (no undefined)
      expect(expr.tensor).toBeDefined();
      expect(expr.shape).toEqual([3]);
      expect(expr.rank).toBe(1);
    }
  });
});

describe('isDictionary', () => {
  test('returns true for dictionaries', () => {
    const expr = ce.expr([
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
    ]);
    expect(isDictionary(expr)).toBe(true);
  });

  test('returns false for non-dictionaries', () => {
    expect(isDictionary(ce.expr(42))).toBe(false);
    expect(isDictionary(ce.expr('x'))).toBe(false);
    expect(isDictionary(null)).toBe(false);
    expect(isDictionary(undefined)).toBe(false);
  });

  test('narrows type to include DictionaryInterface', () => {
    const expr = ce.expr([
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
    const list = ce.expr(['List', 1, 2, 3]);
    expect(isCollection(list)).toBe(true);
  });

  test('returns true for Range (lazy collection)', () => {
    const range = ce.expr(['Range', 1, 10]);
    expect(isCollection(range)).toBe(true);
  });

  test('returns false for non-collections', () => {
    expect(isCollection(ce.expr(42))).toBe(false);
    expect(isCollection(ce.expr('x'))).toBe(false);
    expect(isCollection(null)).toBe(false);
    expect(isCollection(undefined)).toBe(false);
  });

  test('narrows type to CollectionInterface', () => {
    const list = ce.expr(['List', 1, 2, 3]);
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
    const list = ce.expr(['List', 1, 2, 3]);
    expect(isIndexedCollection(list)).toBe(true);
  });

  test('returns false for non-indexed collections', () => {
    expect(isIndexedCollection(ce.expr(42))).toBe(false);
    expect(isIndexedCollection(ce.expr('x'))).toBe(false);
    expect(isIndexedCollection(null)).toBe(false);
    expect(isIndexedCollection(undefined)).toBe(false);
  });

  test('narrows type to IndexedCollectionInterface', () => {
    const list = ce.expr(['List', 1, 2, 3]);
    if (isIndexedCollection(list)) {
      expect(list.isIndexedCollection).toBe(true);
      // at() is available
      const first = list.at(1);
      expect(first).toBeDefined();
      expect(first!.re).toBe(1);
    }
  });
});
