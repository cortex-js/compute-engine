import { ComputeEngine } from '../../src/compute-engine';

// Note: Use single-letter symbols because LaTeX parses multi-letter
// sequences as products of individual letters (e.g., "abc" becomes a*b*c)

describe('DECLARATIVE SEQUENCE DEFINITIONS', () => {
  describe('Programmatic API (declareSequence)', () => {
    test('Arithmetic sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('A', {
        base: { 0: 1 },
        recurrence: 'A_{n-1} + 2',
      });
      expect(ce.parse('A_{0}').evaluate().re).toBe(1);
      expect(ce.parse('A_{5}').evaluate().re).toBe(11);
    });

    test('Geometric sequence', () => {
      const ce = new ComputeEngine();
      // Note: Can't use 'G' as it maps to CatalanConstant in LaTeX
      ce.declareSequence('Z', {
        base: { 0: 1 },
        recurrence: '2 \\cdot Z_{n-1}',
      });
      expect(ce.parse('Z_{0}').evaluate().re).toBe(1);
      expect(ce.parse('Z_{5}').evaluate().re).toBe(32);
    });

    test('Fibonacci sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('F', {
        base: { 0: 0, 1: 1 },
        recurrence: 'F_{n-1} + F_{n-2}',
      });
      expect(ce.parse('F_{0}').evaluate().re).toBe(0);
      expect(ce.parse('F_{1}').evaluate().re).toBe(1);
      expect(ce.parse('F_{10}').evaluate().re).toBe(55);
    });

    test('Factorial via recurrence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('H', {
        base: { 0: 1 },
        recurrence: 'n \\cdot H_{n-1}',
      });
      expect(ce.parse('H_{0}').evaluate().re).toBe(1);
      expect(ce.parse('H_{5}').evaluate().re).toBe(120);
    });

    test('Triangular numbers', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('T', {
        base: { 0: 0 },
        recurrence: 'T_{n-1} + n',
      });
      expect(ce.parse('T_{0}').evaluate().re).toBe(0);
      expect(ce.parse('T_{5}').evaluate().re).toBe(15);
    });

    test('Sequence with BoxedExpression base case', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('B', {
        base: { 0: ce.number(10) },
        recurrence: 'B_{n-1} + 1',
      });
      expect(ce.parse('B_{0}').evaluate().re).toBe(10);
      expect(ce.parse('B_{3}').evaluate().re).toBe(13);
    });
  });

  // LaTeX API for sequence definitions using assignment notation
  // e.g., L_0 := 1 and L_n := L_{n-1} + 2
  describe('LaTeX API (assignment notation)', () => {
    test('Arithmetic sequence via LaTeX', () => {
      const ce = new ComputeEngine();
      ce.parse('L_0 := 1').evaluate();
      ce.parse('L_n := L_{n-1} + 2').evaluate();
      expect(ce.parse('L_{5}').evaluate().re).toBe(11);
    });

    test('Fibonacci via LaTeX', () => {
      const ce = new ComputeEngine();
      ce.parse('J_0 := 0').evaluate();
      ce.parse('J_1 := 1').evaluate();
      ce.parse('J_n := J_{n-1} + J_{n-2}').evaluate();
      expect(ce.parse('J_{10}').evaluate().re).toBe(55);
    });

    test('Recurrence first, then base case', () => {
      const ce = new ComputeEngine();
      ce.parse('K_n := K_{n-1} + 1').evaluate();
      ce.parse('K_0 := 0').evaluate(); // Sequence finalized here
      expect(ce.parse('K_{5}').evaluate().re).toBe(5);
    });

    test('Multiple base cases', () => {
      const ce = new ComputeEngine();
      ce.parse('V_0 := 2').evaluate();
      ce.parse('V_1 := 1').evaluate();
      ce.parse('V_n := V_{n-1} + V_{n-2}').evaluate();
      // V: 2, 1, 3, 4, 7, 11, 18, 29, 47, 76, 123
      expect(ce.parse('V_{10}').evaluate().re).toBe(123);
    });

    test('Factorial via LaTeX', () => {
      const ce = new ComputeEngine();
      ce.parse('D_0 := 1').evaluate();
      ce.parse('D_n := n \\cdot D_{n-1}').evaluate();
      expect(ce.parse('D_{5}').evaluate().re).toBe(120);
    });

    test('Braced subscript base case', () => {
      const ce = new ComputeEngine();
      ce.parse('C_{0} := 10').evaluate();
      ce.parse('C_{n} := C_{n-1} + 5').evaluate();
      expect(ce.parse('C_{3}').evaluate().re).toBe(25);
    });
  });

  describe('Symbolic Behavior', () => {
    test('Symbolic subscript stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('P', {
        base: { 0: 1 },
        recurrence: 'P_{n-1} + 1',
      });
      const result = ce.parse('P_k').evaluate();
      expect(result.operator).toBe('Subscript');
    });

    test('Non-integer subscript stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Q', {
        base: { 0: 1 },
        recurrence: 'Q_{n-1} + 1',
      });
      const result = ce.parse('Q_{1.5}').evaluate();
      expect(result.operator).toBe('Subscript');
    });
  });

  describe('Arithmetic with Sequences', () => {
    test('Sum of sequence values', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('R', {
        base: { 0: 0 },
        recurrence: 'R_{n-1} + n',
      });
      // R_5 = 15, R_3 = 6
      expect(ce.parse('R_{5} + R_{3}').evaluate().re).toBe(21);
    });

    test('Product with sequence value', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('U', {
        base: { 0: 1 },
        recurrence: 'U_{n-1} + 1',
      });
      // U_5 = 6
      expect(ce.parse('2 \\cdot U_{5}').evaluate().re).toBe(12);
    });
  });

  describe('Custom Variable Name', () => {
    test('Use k instead of n', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('W', {
        variable: 'k',
        base: { 0: 1 },
        recurrence: 'W_{k-1} + k',
      });
      // W_0 = 1
      // W_1 = W_0 + 1 = 1 + 1 = 2
      // W_2 = W_1 + 2 = 2 + 2 = 4
      // W_3 = W_2 + 3 = 4 + 3 = 7
      // W_4 = W_3 + 4 = 7 + 4 = 11
      // W_5 = W_4 + 5 = 11 + 5 = 16
      expect(ce.parse('W_{5}').evaluate().re).toBe(16);
    });
  });

  describe('Domain Constraints', () => {
    test('Minimum index constraint', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('X', {
        base: { 1: 1 },
        recurrence: 'X_{n-1} + 1',
        domain: { min: 1 },
      });
      expect(ce.parse('X_{5}').evaluate().re).toBe(5);
      // Index 0 is outside domain, stays symbolic
      const result = ce.parse('X_{0}').evaluate();
      expect(result.operator).toBe('Subscript');
    });

    test('Maximum index constraint', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Y', {
        base: { 0: 1 },
        recurrence: 'Y_{n-1} + 1',
        domain: { max: 10 },
      });
      expect(ce.parse('Y_{5}').evaluate().re).toBe(6);
      // Index 11 is outside domain, stays symbolic
      const result = ce.parse('Y_{11}').evaluate();
      expect(result.operator).toBe('Subscript');
    });
  });

  describe('Edge Cases', () => {
    test('Missing required base case throws', () => {
      const ce = new ComputeEngine();
      expect(() => {
        ce.declareSequence('Z', {
          base: {},
          recurrence: 'Z_{n-1} + 1',
        });
      }).toThrow();
    });

    test('Missing recurrence throws', () => {
      const ce = new ComputeEngine();
      expect(() => {
        ce.declareSequence('E', {
          base: { 0: 1 },
          recurrence: '',
        });
      }).toThrow();
    });

    test('Negative index stays symbolic with domain constraints', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('N', {
        base: { 0: 0 },
        recurrence: 'N_{n-1} + 1',
        domain: { min: 0 }, // Constrain to non-negative indices
      });
      // Negative index is outside domain, stays symbolic
      const result = ce.parse('N_{-1}').evaluate();
      expect(result.operator).toBe('Subscript');
    });
  });

  describe('Memoization', () => {
    test('Large Fibonacci is efficient', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('M', {
        base: { 0: 0, 1: 1 },
        recurrence: 'M_{n-1} + M_{n-2}',
      });
      // Should complete quickly with memoization
      const start = Date.now();
      const result = ce.parse('M_{30}').evaluate().re;
      const elapsed = Date.now() - start;
      expect(result).toBe(832040);
      expect(elapsed).toBeLessThan(5000); // Should be very fast with memoization
    });

    test('Memoization disabled works but may be slower', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('O', {
        base: { 0: 1 },
        recurrence: 'O_{n-1} + 1',
        memoize: false,
      });
      // Should still work correctly
      expect(ce.parse('O_{5}').evaluate().re).toBe(6);
    });
  });

  describe('N() numeric approximation', () => {
    test('N() works with sequences', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('S', {
        base: { 0: 1 },
        recurrence: 'S_{n-1} + 1',
      });
      expect(ce.parse('S_{5}').N().re).toBe(6);
    });
  });
});
