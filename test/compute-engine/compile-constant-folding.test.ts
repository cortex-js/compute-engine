import { engine as ce } from '../utils';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  formatFloat,
} from '../../src/compute-engine/compilation/constant-folding';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

describe('CONSTANT FOLDING UTILITIES', () => {
  describe('formatFloat', () => {
    it('adds .0 to integers', () => {
      expect(formatFloat(5)).toBe('5.0');
    });

    it('preserves existing decimal', () => {
      expect(formatFloat(3.14)).toBe('3.14');
    });

    it('handles negative integers', () => {
      expect(formatFloat(-7)).toBe('-7.0');
    });

    it('handles zero', () => {
      expect(formatFloat(0)).toBe('0.0');
    });
  });

  describe('tryGetConstant', () => {
    it('returns value for integer literal', () => {
      expect(tryGetConstant(ce.expr(42))).toBe(42);
    });

    it('returns value for float literal', () => {
      expect(tryGetConstant(ce.expr(3.14))).toBeCloseTo(3.14);
    });

    it('returns value for negative number', () => {
      expect(tryGetConstant(ce.expr(-7))).toBe(-7);
    });

    it('returns value for zero', () => {
      expect(tryGetConstant(ce.expr(0))).toBe(0);
    });

    it('returns undefined for symbol', () => {
      expect(tryGetConstant(ce.expr('x'))).toBeUndefined();
    });

    it('returns undefined for function expression', () => {
      expect(tryGetConstant(ce.parse('x+1'))).toBeUndefined();
    });

    it('returns undefined for complex number', () => {
      expect(tryGetConstant(ce.expr(['Complex', 3, 4]))).toBeUndefined();
    });

    it('returns undefined for NaN', () => {
      expect(tryGetConstant(ce.expr(NaN))).toBeUndefined();
    });

    it('returns undefined for Infinity', () => {
      expect(tryGetConstant(ce.expr(Infinity))).toBeUndefined();
    });
  });

  describe('foldTerms (addition)', () => {
    it('returns identity for empty terms', () => {
      expect(foldTerms([], '0.0', '+')).toBe('0.0');
    });

    it('returns single term unchanged', () => {
      expect(foldTerms(['x'], '0.0', '+')).toBe('x');
    });

    it('joins multiple symbolic terms', () => {
      expect(foldTerms(['x', 'y'], '0.0', '+')).toBe('x + y');
    });

    it('folds numeric literals', () => {
      expect(foldTerms(['2.0', '3.0'], '0.0', '+')).toBe('5.0');
    });

    it('folds mixed numeric and symbolic terms', () => {
      expect(foldTerms(['2.0', 'x', '3.0'], '0.0', '+')).toBe('5.0 + x');
    });

    it('eliminates zero terms', () => {
      expect(foldTerms(['x', '0.0', 'y'], '0.0', '+')).toBe('x + y');
    });

    it('returns identity when all terms are zero', () => {
      expect(foldTerms(['0.0', '0.0'], '0.0', '+')).toBe('0.0');
    });
  });

  describe('foldTerms (multiplication)', () => {
    it('returns identity for empty terms', () => {
      expect(foldTerms([], '1.0', '*')).toBe('1.0');
    });

    it('returns single term unchanged', () => {
      expect(foldTerms(['x'], '1.0', '*')).toBe('x');
    });

    it('folds numeric literals', () => {
      expect(foldTerms(['2.0', '3.0'], '1.0', '*')).toBe('6.0');
    });

    it('folds mixed numeric and symbolic terms', () => {
      expect(foldTerms(['2.0', 'x', '3.0'], '1.0', '*')).toBe('6.0 * x');
    });

    it('eliminates one-valued terms', () => {
      expect(foldTerms(['x', '1.0', 'y'], '1.0', '*')).toBe('x * y');
    });

    it('absorbs on zero', () => {
      expect(foldTerms(['x', '0.0', 'y'], '1.0', '*')).toBe('0.0');
    });
  });

  describe('tryGetComplexParts', () => {
    // A simple mock compile function that returns the symbol name
    // or a formatted number for literals.
    const mockCompile = (expr: any): string => {
      if (expr._kind === 'symbol') return expr.symbol;
      if (expr._kind === 'number') {
        const re = expr.re;
        const str = re.toString();
        if (!str.includes('.') && !str.includes('e') && !str.includes('E'))
          return `${str}.0`;
        return str;
      }
      return `compiled(${expr.toString()})`;
    };

    it('decomposes ImaginaryUnit', () => {
      const result = tryGetComplexParts(ce.expr('ImaginaryUnit'), mockCompile);
      expect(result).toEqual({ re: null, im: '1.0' });
    });

    it('decomposes Complex(3, 4)', () => {
      const result = tryGetComplexParts(
        ce.expr(['Complex', 3, 4]),
        mockCompile
      );
      expect(result).toEqual({ re: '3.0', im: '4.0' });
    });

    it('decomposes Complex(0, 5)', () => {
      const result = tryGetComplexParts(
        ce.expr(['Complex', 0, 5]),
        mockCompile
      );
      expect(result).toEqual({ re: null, im: '5.0' });
    });

    it('decomposes Complex(3, 0) as purely real', () => {
      // Complex(3, 0) is canonicalized to just the number 3
      const expr = ce.expr(['Complex', 3, 0]);
      const result = tryGetComplexParts(expr, mockCompile);
      expect(result).toEqual({ re: '3.0', im: null });
    });

    it('decomposes real symbol as purely real', () => {
      const result = tryGetComplexParts(ce.expr('x'), mockCompile);
      expect(result).toEqual({ re: 'x', im: null });
    });

    it('decomposes Multiply(y, ImaginaryUnit)', () => {
      const result = tryGetComplexParts(
        ce.expr(['Multiply', 'y', 'ImaginaryUnit']),
        mockCompile
      );
      expect(result).toEqual({ re: null, im: 'y' });
    });

    it('decomposes Multiply(3, ImaginaryUnit)', () => {
      const result = tryGetComplexParts(
        ce.expr(['Multiply', 3, 'ImaginaryUnit']),
        mockCompile
      );
      expect(result).toEqual({ re: null, im: '3.0' });
    });
  });
});

const glsl = new GLSLTarget();

describe('GPU HANDLER CONSTANT FOLDING', () => {
  describe('GPU Add — complex folding', () => {
    it('should fold x + 3i to vec2(x, 3.0)', () => {
      expect(glsl.compile(ce.parse('x+3i')).code).toBe('vec2(x, 3.0)');
    });

    it('should fold Complex(3, 4) to vec2(3.0, 4.0)', () => {
      expect(glsl.compile(ce.expr(['Complex', 3, 4])).code).toBe(
        'vec2(3.0, 4.0)'
      );
    });

    it('should fold Complex(1,2) + Complex(3,4) to vec2(4.0, 6.0)', () => {
      expect(
        glsl.compile(ce.expr(['Add', ['Complex', 1, 2], ['Complex', 3, 4]]))
          .code
      ).toBe('vec2(4.0, 6.0)');
    });

    it('should fold x + Complex(0, 3) to vec2(x, 3.0)', () => {
      expect(
        glsl.compile(ce.expr(['Add', 'x', ['Complex', 0, 3]])).code
      ).toBe('vec2(x, 3.0)');
    });
  });

  describe('GPU Multiply — complex folding', () => {
    it('should fold y * i to vec2(0.0, y)', () => {
      expect(
        glsl.compile(ce.expr(['Multiply', 'y', 'ImaginaryUnit'])).code
      ).toBe('vec2(0.0, y)');
    });

    it('should fold 3 * i to vec2(0.0, 3.0)', () => {
      expect(
        glsl.compile(ce.expr(['Multiply', 3, 'ImaginaryUnit'])).code
      ).toBe('vec2(0.0, 3.0)');
    });
  });

  describe('GPU Subtract (canonicalizes to Add) — complex folding', () => {
    it('x - 3i → vec2(x, -3.0) via Add(x, Complex(0,-3))', () => {
      expect(
        glsl.compile(ce.expr(['Subtract', 'x', ['Complex', 0, 3]])).code
      ).toBe('vec2(x, -3.0)');
    });

    it('(5+3i) - (2+i) → vec2(3.0, 2.0)', () => {
      expect(
        glsl.compile(
          ce.expr(['Subtract', ['Complex', 5, 3], ['Complex', 2, 1]])
        ).code
      ).toBe('vec2(3.0, 2.0)');
    });

    it('5i - 2i → vec2(0.0, 3.0)', () => {
      expect(
        glsl.compile(
          ce.expr(['Subtract', ['Complex', 0, 5], ['Complex', 0, 2]])
        ).code
      ).toBe('vec2(0.0, 3.0)');
    });
  });

  describe('GPU Square — simple operand guard', () => {
    it('Square(x) expands to (x * x) for symbol', () => {
      expect(glsl.compile(ce.expr(['Square', 'x'])).code).toBe('(x * x)');
    });

    it('Square(Sin(x)) uses pow to avoid duplicate computation', () => {
      expect(glsl.compile(ce.expr(['Square', ['Sin', 'x']])).code).toBe(
        'pow(sin(x), 2.0)'
      );
    });
  });

  describe('GPU Negate — folding', () => {
    it('should fold Negate(ImaginaryUnit) to vec2(0.0, -1.0)', () => {
      expect(
        glsl.compile(ce.expr(['Negate', 'ImaginaryUnit'])).code
      ).toBe('vec2(0.0, -1.0)');
    });

    it('should compile Negate(x) as -x via operator path', () => {
      expect(glsl.compile(ce.expr(['Negate', 'x'])).code).toBe('-x');
    });
  });

  describe('GPU Power — folding', () => {
    it('should fold Power(x, 0) to 1.0', () => {
      expect(glsl.compile(ce.expr(['Power', 'x', 0])).code).toBe('1.0');
    });

    it('should fold Power(x, 2) to (x * x) for simple operands', () => {
      expect(glsl.compile(ce.expr(['Power', 'x', 2])).code).toBe('(x * x)');
    });

    it('should NOT fold Power(Sin(x), 2) to avoid duplicate computation', () => {
      expect(glsl.compile(ce.expr(['Power', ['Sin', 'x'], 2])).code).toBe(
        'pow(sin(x), 2.0)'
      );
    });

    it('should compile Power(x, 3) as pow(x, 3.0)', () => {
      expect(glsl.compile(ce.expr(['Power', 'x', 3])).code).toBe(
        'pow(x, 3.0)'
      );
    });
  });

  describe('GPU Root — folding', () => {
    it('should fold Root(27, 3) to 3.0', () => {
      expect(glsl.compile(ce.expr(['Root', 27, 3])).code).toBe('3.0');
    });

    it('should compile Root(x, 3) as pow(x, 1.0 / 3.0)', () => {
      expect(glsl.compile(ce.expr(['Root', 'x', 3])).code).toBe(
        'pow(x, 1.0 / 3.0)'
      );
    });
  });
});

const js = new JavaScriptTarget();

describe('TYPE-BASED OPTIMIZATIONS', () => {
  // Declare integer-typed symbols for tests
  beforeAll(() => {
    ce.declare('n', { type: 'integer', value: undefined });
    ce.declare('m', { type: 'integer', value: undefined });
  });

  describe('Floor/Ceil/Round/Truncate — integer no-op', () => {
    it('GPU: Floor(n) is a no-op for integer n', () => {
      expect(glsl.compile(ce.expr(['Floor', 'n'])).code).toBe('n');
    });

    it('GPU: Ceil(n) is a no-op for integer n', () => {
      expect(glsl.compile(ce.expr(['Ceil', 'n'])).code).toBe('n');
    });

    it('GPU: Round(n) is a no-op for integer n', () => {
      expect(glsl.compile(ce.expr(['Round', 'n'])).code).toBe('n');
    });

    it('GPU: Truncate(n) is a no-op for integer n', () => {
      expect(glsl.compile(ce.expr(['Truncate', 'n'])).code).toBe('n');
    });

    it('GPU: Floor(x) still calls floor() for real x', () => {
      expect(glsl.compile(ce.expr(['Floor', 'x'])).code).toBe('floor(x)');
    });

    it('GPU: Floor(3) is a no-op for integer literal', () => {
      expect(glsl.compile(ce.expr(['Floor', 3])).code).toBe('3.0');
    });

    it('JS: Floor(n) is a no-op for integer n', () => {
      expect(js.compile(ce.expr(['Floor', 'n'])).code).toBe('_.n');
    });

    it('JS: Floor(x) still calls Math.floor() for real x', () => {
      expect(js.compile(ce.expr(['Floor', 'x'])).code).toBe(
        'Math.floor(_.x)'
      );
    });

    it('JS: Ceil(n) is a no-op for integer n', () => {
      expect(js.compile(ce.expr(['Ceil', 'n'])).code).toBe('_.n');
    });

    it('JS: Truncate(n) is a no-op for integer n', () => {
      expect(js.compile(ce.expr(['Truncate', 'n'])).code).toBe('_.n');
    });
  });

  describe('Abs — non-negative no-op', () => {
    it('GPU: Abs(5) is a no-op for non-negative constant', () => {
      expect(glsl.compile(ce.expr(['Abs', 5])).code).toBe('5.0');
    });

    it('GPU: Abs(x) still calls abs() for general x', () => {
      expect(glsl.compile(ce.expr(['Abs', 'x'])).code).toBe('abs(x)');
    });

    it('JS: Abs(7) is a no-op for non-negative constant', () => {
      expect(js.compile(ce.expr(['Abs', 7])).code).toBe('7');
    });

    it('JS: Abs(x) still calls Math.abs() for general x', () => {
      expect(js.compile(ce.expr(['Abs', 'x'])).code).toBe('Math.abs(_.x)');
    });
  });

  describe('JS constant folding', () => {
    it('JS: Subtract(10, 3) folds to 7', () => {
      expect(js.compile(ce.expr(['Subtract', 10, 3])).code).toBe('7');
    });

    it('JS: Divide(10, 2) folds to 5', () => {
      expect(js.compile(ce.expr(['Divide', 10, 2])).code).toBe('5');
    });

    it('JS: Negate(5) folds to -5', () => {
      expect(js.compile(ce.expr(['Negate', 5])).code).toBe('-5');
    });

    it('JS: Sqrt(9) folds to 3', () => {
      expect(js.compile(ce.expr(['Sqrt', 9])).code).toBe('3');
    });

    it('JS: Power(2, 10) folds to 1024', () => {
      expect(js.compile(ce.expr(['Power', 2, 10])).code).toBe('1024');
    });

    it('JS: Power(x, 0) folds to 1', () => {
      expect(js.compile(ce.expr(['Power', 'x', 0])).code).toBe('1');
    });

    it('JS: Power(x, 2) uses x * x for simple operand', () => {
      expect(js.compile(ce.expr(['Power', 'x', 2])).code).toBe(
        '(_.x * _.x)'
      );
    });

    it('JS: Power(Sin(x), 2) uses Math.pow for complex operand', () => {
      expect(js.compile(ce.expr(['Power', ['Sin', 'x'], 2])).code).toBe(
        'Math.pow(Math.sin(_.x), 2)'
      );
    });

    it('JS: Root(8, 3) folds to 2', () => {
      expect(js.compile(ce.expr(['Root', 8, 3])).code).toBe('2');
    });

    it('JS: Square(3) folds to 9', () => {
      expect(js.compile(ce.expr(['Square', 3])).code).toBe('9');
    });

    it('JS: Square(x) uses x * x for symbol', () => {
      expect(js.compile(ce.expr(['Square', 'x'])).code).toBe('(_.x * _.x)');
    });

    it('JS: Square(Sin(x)) uses Math.pow for complex operand', () => {
      expect(js.compile(ce.expr(['Square', ['Sin', 'x']])).code).toBe(
        'Math.pow(Math.sin(_.x), 2)'
      );
    });
  });
});
