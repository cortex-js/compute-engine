import { ComputeEngine } from '../../src/compute-engine';

describe('SUBSCRIPT EVALUATE HANDLER', () => {
  describe('Basic Usage', () => {
    test('Simple sequence definition (squares)', () => {
      const ce = new ComputeEngine();
      ce.declare('S', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n) || n < 0) return undefined;
          return engine.number(n * n);
        },
      });

      expect(ce.parse('S_{5}').evaluate().re).toBe(25);
      expect(ce.parse('S_{0}').evaluate().re).toBe(0);
      expect(ce.parse('S_{10}').evaluate().re).toBe(100);
    });

    test('Simple subscript F_5 also uses subscriptEvaluate', () => {
      const ce = new ComputeEngine();
      ce.declare('T', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n) || n < 0) return undefined;
          return engine.number(n * 3);
        },
      });

      // Simple subscript (no braces) should also work
      expect(ce.parse('T_5').evaluate().re).toBe(15);
      expect(ce.parse('T_0').evaluate().re).toBe(0);
    });

    test('Fibonacci sequence', () => {
      const ce = new ComputeEngine();
      const fibMemo = new Map<number, number>();
      const fib = (n: number): number => {
        if (n <= 1) return n;
        if (fibMemo.has(n)) return fibMemo.get(n)!;
        const result = fib(n - 1) + fib(n - 2);
        fibMemo.set(n, result);
        return result;
      };

      ce.declare('F', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n) || n < 0) return undefined;
          return engine.number(fib(n));
        },
      });

      expect(ce.parse('F_{0}').evaluate().re).toBe(0);
      expect(ce.parse('F_{1}').evaluate().re).toBe(1);
      expect(ce.parse('F_{5}').evaluate().re).toBe(5);
      expect(ce.parse('F_{10}').evaluate().re).toBe(55);
      expect(ce.parse('F_{20}').evaluate().re).toBe(6765);
    });

    test('Symbolic subscripts stay symbolic', () => {
      const ce = new ComputeEngine();
      ce.declare('a', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isFinite(n)) return undefined;
          return engine.number(n * 2);
        },
      });

      // Numeric subscript evaluates
      expect(ce.parse('a_{5}').evaluate().re).toBe(10);

      // Symbolic subscript stays as Subscript
      const result = ce.parse('a_{n}').evaluate();
      expect(result.operator).toBe('Subscript');
    });
  });

  describe('Multi-Index Subscripts', () => {
    test('Matrix-like 2D indexing with Sequence', () => {
      const ce = new ComputeEngine();
      const matrix = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ];

      ce.declare('M', {
        subscriptEvaluate: (subscript, { engine }) => {
          // Multi-index comes as Tuple
          if (subscript.operator === 'Tuple' && subscript.ops) {
            const [iExpr, jExpr] = subscript.ops;
            const i = iExpr.re;
            const j = jExpr.re;
            if (Number.isInteger(i) && Number.isInteger(j)) {
              const row = matrix[i - 1]; // 1-indexed
              if (row && row[j - 1] !== undefined) {
                return engine.number(row[j - 1]);
              }
            }
          }
          return undefined;
        },
      });

      expect(ce.parse('M_{1,1}').evaluate().re).toBe(1);
      expect(ce.parse('M_{2,3}').evaluate().re).toBe(6);
      expect(ce.parse('M_{3,3}').evaluate().re).toBe(9);
    });
  });

  describe('Edge Cases', () => {
    test('Handler returning undefined falls back to symbolic', () => {
      const ce = new ComputeEngine();
      ce.declare('X', {
        subscriptEvaluate: () => undefined, // Always return undefined
      });

      const result = ce.parse('X_{5}').evaluate();
      expect(result.operator).toBe('Subscript');
    });

    test('Symbol without subscriptEvaluate creates compound symbol', () => {
      const ce = new ComputeEngine();
      // Don't declare any subscriptEvaluate

      // Simple subscript becomes compound symbol
      const result = ce.parse('y_5');
      expect(result.symbol).toBe('y_5');
    });

    test('Invalid index handling', () => {
      const ce = new ComputeEngine();
      ce.declare('P', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n) || n < 1) {
            return engine.symbol('Undefined');
          }
          return engine.number(n);
        },
      });

      expect(ce.parse('P_{0}').evaluate().symbol).toBe('Undefined');
      expect(ce.parse('P_{-1}').evaluate().symbol).toBe('Undefined');
      expect(ce.parse('P_{1}').evaluate().re).toBe(1);
    });

    test('Non-integer subscript stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.declare('R', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n)) return undefined;
          return engine.number(n);
        },
      });

      // Non-integer stays symbolic
      const result = ce.parse('R_{1.5}').evaluate();
      expect(result.operator).toBe('Subscript');
    });
  });

  describe('Arithmetic with Subscripted Expressions', () => {
    test('Arithmetic operations on evaluated subscripts', () => {
      const ce = new ComputeEngine();
      ce.declare('a', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isInteger(n)) return undefined;
          return engine.number(n * 10);
        },
      });

      // a_5 + a_3 = 50 + 30 = 80
      expect(ce.parse('a_{5} + a_{3}').evaluate().re).toBe(80);

      // a_2 * 3 = 20 * 3 = 60
      expect(ce.parse('a_{2} \\cdot 3').evaluate().re).toBe(60);
    });

    test('Complex subscript in arithmetic', () => {
      const ce = new ComputeEngine();
      ce.declare('b', {
        subscriptEvaluate: (subscript, { engine }) => {
          const n = subscript.re;
          if (!Number.isFinite(n)) return undefined;
          return engine.number(n * 2);
        },
      });

      // b_{3+2} = b_5 = 10
      expect(ce.parse('b_{3+2}').evaluate().re).toBe(10);

      // b_{2*3} = b_6 = 12
      expect(ce.parse('b_{2 \\cdot 3}').evaluate().re).toBe(12);
    });
  });

  describe('Numeric Approximation', () => {
    test('Handler receives numericApproximation option', () => {
      const ce = new ComputeEngine();
      let receivedNumericApprox: boolean | undefined;

      ce.declare('Q', {
        subscriptEvaluate: (subscript, { engine, numericApproximation }) => {
          receivedNumericApprox = numericApproximation;
          const n = subscript.re;
          if (!Number.isInteger(n)) return undefined;
          return engine.number(n);
        },
      });

      // evaluate() should pass false or undefined
      ce.parse('Q_{5}').evaluate();
      expect(receivedNumericApprox).toBeFalsy();

      // N() should pass true
      ce.parse('Q_{5}').N();
      expect(receivedNumericApprox).toBe(true);
    });
  });
});
