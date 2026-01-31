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

  describe('Sequence Status (SUB-6)', () => {
    test('Not a sequence returns correct status', () => {
      const ce = new ComputeEngine();
      const status = ce.getSequenceStatus('x');
      expect(status.status).toBe('not-a-sequence');
      expect(status.hasBase).toBe(false);
      expect(status.hasRecurrence).toBe(false);
      expect(status.baseIndices).toEqual([]);
    });

    test('Pending with base only', () => {
      const ce = new ComputeEngine();
      ce.parse('G_0 := 0').evaluate();
      const status = ce.getSequenceStatus('G');
      expect(status.status).toBe('pending');
      expect(status.hasBase).toBe(true);
      expect(status.hasRecurrence).toBe(false);
      expect(status.baseIndices).toEqual([0]);
    });

    test('Pending with recurrence only', () => {
      const ce = new ComputeEngine();
      ce.parse('E_n := E_{n-1} + 1').evaluate();
      const status = ce.getSequenceStatus('E');
      expect(status.status).toBe('pending');
      expect(status.hasBase).toBe(false);
      expect(status.hasRecurrence).toBe(true);
      expect(status.variable).toBe('n');
    });

    test('Pending with multiple base cases', () => {
      const ce = new ComputeEngine();
      ce.parse('I_0 := 0').evaluate();
      ce.parse('I_1 := 1').evaluate();
      const status = ce.getSequenceStatus('I');
      expect(status.status).toBe('pending');
      expect(status.hasBase).toBe(true);
      expect(status.baseIndices).toEqual([0, 1]);
    });

    test('Complete sequence via LaTeX', () => {
      const ce = new ComputeEngine();
      ce.parse('S_0 := 0').evaluate();
      ce.parse('S_n := S_{n-1} + 1').evaluate();
      const status = ce.getSequenceStatus('S');
      expect(status.status).toBe('complete');
      expect(status.hasBase).toBe(true);
      expect(status.hasRecurrence).toBe(true);
    });

    test('declareSequence creates complete sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Q', {
        base: { 0: 1 },
        recurrence: 'Q_{n-1} + 1',
      });
      const status = ce.getSequenceStatus('Q');
      expect(status.status).toBe('complete');
      expect(status.hasBase).toBe(true);
      expect(status.hasRecurrence).toBe(true);
    });
  });

  describe('Sequence Introspection (SUB-7)', () => {
    test('getSequence returns undefined for non-sequence', () => {
      const ce = new ComputeEngine();
      expect(ce.getSequence('x')).toBeUndefined();
    });

    test('getSequence returns info for complete sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('F', {
        base: { 0: 0, 1: 1 },
        recurrence: 'F_{n-1} + F_{n-2}',
      });
      const info = ce.getSequence('F');
      expect(info).toBeDefined();
      expect(info!.name).toBe('F');
      expect(info!.variable).toBe('n');
      expect(info!.baseIndices).toEqual([0, 1]);
      expect(info!.memoize).toBe(true);
      expect(info!.cacheSize).toBe(0);
    });

    test('listSequences returns empty for no sequences', () => {
      const ce = new ComputeEngine();
      expect(ce.listSequences()).toEqual([]);
    });

    test('listSequences returns all sequence names', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('A', { base: { 0: 1 }, recurrence: 'A_{n-1} + 1' });
      ce.declareSequence('B', { base: { 0: 2 }, recurrence: 'B_{n-1} + 2' });
      const names = ce.listSequences();
      expect(names).toContain('A');
      expect(names).toContain('B');
      expect(names.length).toBe(2);
    });

    test('isSequence returns true for sequences', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('S', { base: { 0: 1 }, recurrence: 'S_{n-1} + 1' });
      expect(ce.isSequence('S')).toBe(true);
      expect(ce.isSequence('x')).toBe(false);
    });

    test('getSequenceCache returns cache with computed values', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('C', { base: { 0: 0 }, recurrence: 'C_{n-1} + 1' });
      // Evaluate some terms to populate cache
      ce.parse('C_{5}').evaluate();
      const cache = ce.getSequenceCache('C');
      expect(cache).toBeDefined();
      expect(cache!.size).toBeGreaterThan(0);
      expect(cache!.get(5)?.re).toBe(5);
    });

    test('getSequenceCache returns undefined for non-sequence', () => {
      const ce = new ComputeEngine();
      expect(ce.getSequenceCache('x')).toBeUndefined();
    });

    // Note: Avoid 'D' as it's the built-in derivative function
    test('clearSequenceCache clears specific sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('W', { base: { 0: 1 }, recurrence: 'W_{n-1} + 1' });
      ce.parse('W_{10}').evaluate();
      expect(ce.getSequenceCache('W')!.size).toBeGreaterThan(0);

      ce.clearSequenceCache('W');
      expect(ce.getSequenceCache('W')!.size).toBe(0);
    });

    // Note: Avoid 'E' (Euler's number), 'G' (CatalanConstant), 'D' (derivative)
    test('clearSequenceCache clears all sequences', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('P', { base: { 0: 1 }, recurrence: 'P_{n-1} + 1' });
      ce.declareSequence('Q', { base: { 0: 2 }, recurrence: 'Q_{n-1} + 2' });
      ce.parse('P_{10}').evaluate();
      ce.parse('Q_{10}').evaluate();

      ce.clearSequenceCache();
      expect(ce.getSequenceCache('P')!.size).toBe(0);
      expect(ce.getSequenceCache('Q')!.size).toBe(0);
    });

    test('cacheSize updates in getSequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('H', { base: { 0: 1 }, recurrence: 'H_{n-1} + 1' });
      expect(ce.getSequence('H')!.cacheSize).toBe(0);

      ce.parse('H_{5}').evaluate();
      expect(ce.getSequence('H')!.cacheSize).toBeGreaterThan(0);

      ce.clearSequenceCache('H');
      expect(ce.getSequence('H')!.cacheSize).toBe(0);
    });

    test('domain constraints reflected in getSequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('J', {
        base: { 1: 1 },
        recurrence: 'J_{n-1} + 1',
        domain: { min: 1, max: 100 },
      });
      const info = ce.getSequence('J');
      expect(info!.domain).toEqual({ min: 1, max: 100 });
    });

    test('memoize=false reflected in getSequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('L', {
        base: { 0: 1 },
        recurrence: 'L_{n-1} + 1',
        memoize: false,
      });
      const info = ce.getSequence('L');
      expect(info!.memoize).toBe(false);
    });

    test('getSequenceCache returns undefined when memoize=false', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('M', {
        base: { 0: 1 },
        recurrence: 'M_{n-1} + 1',
        memoize: false,
      });
      ce.parse('M_{5}').evaluate();
      expect(ce.getSequenceCache('M')).toBeUndefined();
    });
  });

  describe('Generate Sequence Terms (SUB-8)', () => {
    test('getSequenceTerms returns Fibonacci terms', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('F', {
        base: { 0: 0, 1: 1 },
        recurrence: 'F_{n-1} + F_{n-2}',
      });
      const terms = ce.getSequenceTerms('F', 0, 10);
      expect(terms).toBeDefined();
      expect(terms!.map((t) => t.re)).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
    });

    test('getSequenceTerms with arithmetic sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('A', {
        base: { 0: 1 },
        recurrence: 'A_{n-1} + 2',
      });
      const terms = ce.getSequenceTerms('A', 0, 5);
      expect(terms).toBeDefined();
      expect(terms!.map((t) => t.re)).toEqual([1, 3, 5, 7, 9, 11]);
    });

    test('getSequenceTerms with step parameter', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('R', {
        base: { 0: 0, 1: 1 },
        recurrence: 'R_{n-1} + R_{n-2}',
      });
      // Every other Fibonacci term: F_0, F_2, F_4, F_6, F_8, F_10
      const terms = ce.getSequenceTerms('R', 0, 10, 2);
      expect(terms).toBeDefined();
      expect(terms!.map((t) => t.re)).toEqual([0, 1, 3, 8, 21, 55]);
    });

    test('getSequenceTerms returns undefined for non-sequence', () => {
      const ce = new ComputeEngine();
      expect(ce.getSequenceTerms('x', 0, 5)).toBeUndefined();
    });

    test('getSequenceTerms returns undefined for invalid start/end', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('N', {
        base: { 0: 1 },
        recurrence: 'N_{n-1} + 1',
      });
      expect(ce.getSequenceTerms('N', 0.5, 5)).toBeUndefined();
      expect(ce.getSequenceTerms('N', 0, 5.5)).toBeUndefined();
    });

    test('getSequenceTerms returns undefined for invalid step', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('S', {
        base: { 0: 1 },
        recurrence: 'S_{n-1} + 1',
      });
      expect(ce.getSequenceTerms('S', 0, 5, 0)).toBeUndefined();
      expect(ce.getSequenceTerms('S', 0, 5, -1)).toBeUndefined();
    });

    test('getSequenceTerms single term', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('U', {
        base: { 0: 42 },
        recurrence: 'U_{n-1} + 1',
      });
      const terms = ce.getSequenceTerms('U', 0, 0);
      expect(terms).toBeDefined();
      expect(terms!.length).toBe(1);
      expect(terms!.map((t) => t.re)).toEqual([42]);
    });

    test('getSequenceTerms starting from non-zero index', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('X', {
        base: { 0: 0 },
        recurrence: 'X_{n-1} + 1',
      });
      const terms = ce.getSequenceTerms('X', 5, 10);
      expect(terms).toBeDefined();
      expect(terms!.map((t) => t.re)).toEqual([5, 6, 7, 8, 9, 10]);
    });

    test('getSequenceTerms populates cache', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Y', {
        base: { 0: 1 },
        recurrence: 'Y_{n-1} * 2',
      });
      // Initially cache is empty
      expect(ce.getSequenceCache('Y')!.size).toBe(0);
      // Generate terms
      ce.getSequenceTerms('Y', 0, 5);
      // Now cache should have values (except base case which isn't cached)
      expect(ce.getSequenceCache('Y')!.size).toBeGreaterThan(0);
    });
  });

  describe('Summation and Product with Sequences (SUB-11)', () => {
    test('Sum over Fibonacci sequence terms', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('F', {
        base: { 0: 0, 1: 1 },
        recurrence: 'F_{n-1} + F_{n-2}',
      });
      // Sum of F_0 through F_10 = 0+1+1+2+3+5+8+13+21+34+55 = 143
      const result = ce.parse('\\sum_{k=0}^{10} F_k').evaluate();
      expect(result.re).toBe(143);
    });

    test('Sum over arithmetic sequence terms', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('A', {
        base: { 0: 1 },
        recurrence: 'A_{n-1} + 2',
      });
      // A_k = 1 + 2k, so A_0=1, A_1=3, A_2=5, A_3=7, A_4=9
      // Sum from k=0 to 4 = 1+3+5+7+9 = 25
      const result = ce.parse('\\sum_{k=0}^{4} A_k').evaluate();
      expect(result.re).toBe(25);
    });

    test('Product over sequence terms', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('B', {
        base: { 1: 1 },
        recurrence: 'B_{n-1} + 1',
      });
      // B_k = k, so B_1=1, B_2=2, B_3=3, B_4=4, B_5=5
      // Product from k=1 to 5 = 1*2*3*4*5 = 120
      const result = ce.parse('\\prod_{k=1}^{5} B_k').evaluate();
      expect(result.re).toBe(120);
    });

    test('Sum with sequence via LaTeX definition', () => {
      const ce = new ComputeEngine();
      ce.parse('T_0 := 0').evaluate();
      ce.parse('T_n := T_{n-1} + n').evaluate();
      // T_k = triangular numbers: T_0=0, T_1=1, T_2=3, T_3=6, T_4=10
      // Sum from k=0 to 4 = 0+1+3+6+10 = 20
      const result = ce.parse('\\sum_{k=0}^{4} T_k').evaluate();
      expect(result.re).toBe(20);
    });

    test('Sum with expression involving sequence', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('C', {
        base: { 0: 1 },
        recurrence: 'C_{n-1} + 1',
      });
      // C_k = k+1, so C_0=1, C_1=2, C_2=3
      // Sum of 2*C_k from k=0 to 2 = 2*1 + 2*2 + 2*3 = 12
      const result = ce.parse('\\sum_{k=0}^{2} 2 C_k').evaluate();
      expect(result.re).toBe(12);
    });
  });
});
