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

    test('Sequence with Expression base case', () => {
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

// ============================================================================
// MULTI-INDEX SEQUENCES (SUB-9)
// ============================================================================

describe('MULTI-INDEX SEQUENCES (SUB-9)', () => {
  describe('Parser output for multi-index subscripts', () => {
    test('Parser produces Sequence for comma-separated subscripts', () => {
      const ce = new ComputeEngine();
      // The subscript should be a Sequence when there's a comma
      const p00 = ce.parse('Q_{0,0}');
      const pnk = ce.parse('Q_{n,k}');
      const p52 = ce.parse('Q_{5,2}');

      expect(p00.operator).toBe('Subscript');
      expect(p00.op2?.operator).toBe('Sequence');
      expect(pnk.op2?.operator).toBe('Sequence');
      expect(p52.op2?.operator).toBe('Sequence');
    });
  });

  describe('Programmatic API with explicit base cases', () => {
    test('Simple 2x2 grid with all explicit base cases', () => {
      const ce = new ComputeEngine();
      // Use 'U' instead of 'G' (G is reserved for CatalanConstant)
      ce.declareSequence('U', {
        variables: ['i', 'j'],
        base: {
          '0,0': 1,
          '0,1': 2,
          '1,0': 3,
          '1,1': 4,
        },
        recurrence: 'U_{i-1,j} + U_{i,j-1}',
      });

      expect(ce.parse('U_{0,0}').evaluate().re).toBe(1);
      expect(ce.parse('U_{0,1}').evaluate().re).toBe(2);
      expect(ce.parse('U_{1,0}').evaluate().re).toBe(3);
      expect(ce.parse('U_{1,1}').evaluate().re).toBe(4);
    });

    test('Explicit base cases only (no recurrence needed)', () => {
      const ce = new ComputeEngine();
      // A lookup table style multi-index sequence
      // Use 'O' instead of 'T' (T is likely reserved)
      ce.declareSequence('O', {
        variables: ['x', 'y'],
        base: {
          '0,0': 0,
          '1,0': 1,
          '0,1': 10,
          '1,1': 11,
          '2,0': 2,
          '2,1': 12,
        },
        recurrence: '0', // Dummy recurrence (won't be used for these indices)
      });

      expect(ce.parse('O_{0,0}').evaluate().re).toBe(0);
      expect(ce.parse('O_{1,1}').evaluate().re).toBe(11);
      expect(ce.parse('O_{2,1}').evaluate().re).toBe(12);
    });
  });

  describe("Pascal's Triangle", () => {
    test('Programmatic API with pattern base cases', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('P', {
        variables: ['n', 'k'],
        base: {
          '0,0': 1,
          'n,0': 1, // Left edge: P_{n,0} = 1 for all n
          'n,n': 1, // Diagonal: P_{n,n} = 1 (when n = k)
        },
        recurrence: 'P_{n-1,k-1} + P_{n-1,k}',
        domain: { n: { min: 0 }, k: { min: 0 } },
        constraints: 'k \\le n',
      });

      // Base cases
      expect(ce.parse('P_{0,0}').evaluate().re).toBe(1);
      expect(ce.parse('P_{5,0}').evaluate().re).toBe(1);
      expect(ce.parse('P_{5,5}').evaluate().re).toBe(1);
      expect(ce.parse('P_{10,0}').evaluate().re).toBe(1);
      expect(ce.parse('P_{10,10}').evaluate().re).toBe(1);

      // Computed values (Pascal's triangle)
      expect(ce.parse('P_{2,1}').evaluate().re).toBe(2); // C(2,1) = 2
      expect(ce.parse('P_{3,1}').evaluate().re).toBe(3); // C(3,1) = 3
      expect(ce.parse('P_{3,2}').evaluate().re).toBe(3); // C(3,2) = 3
      expect(ce.parse('P_{4,2}').evaluate().re).toBe(6); // C(4,2) = 6
      expect(ce.parse('P_{5,2}').evaluate().re).toBe(10); // C(5,2) = 10
      expect(ce.parse('P_{5,3}').evaluate().re).toBe(10); // C(5,3) = 10
      expect(ce.parse('P_{6,3}').evaluate().re).toBe(20); // C(6,3) = 20
      expect(ce.parse('P_{10,5}').evaluate().re).toBe(252); // C(10,5) = 252
    });

    test('Memoization for multi-index sequences', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Q', {
        variables: ['n', 'k'],
        base: {
          '0,0': 1,
          'n,0': 1,
          'n,n': 1,
        },
        recurrence: 'Q_{n-1,k-1} + Q_{n-1,k}',
      });

      // Compute a value to populate the cache
      ce.parse('Q_{8,4}').evaluate();

      // Check cache has entries
      const cache = ce.getSequenceCache('Q');
      expect(cache).toBeDefined();
      expect(cache!.size).toBeGreaterThan(0);
      expect(cache!.has('8,4')).toBe(true);
      expect(cache!.get('8,4')!.re).toBe(70); // C(8,4) = 70
    });

    test('Clear cache for multi-index sequences', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('R', {
        variables: ['n', 'k'],
        base: { '0,0': 1, 'n,0': 1, 'n,n': 1 },
        recurrence: 'R_{n-1,k-1} + R_{n-1,k}',
      });

      ce.parse('R_{5,2}').evaluate();
      expect(ce.getSequenceCache('R')!.size).toBeGreaterThan(0);

      ce.clearSequenceCache('R');
      expect(ce.getSequenceCache('R')!.size).toBe(0);
    });
  });

  describe('Domain and constraint validation', () => {
    test('Out of domain returns undefined (stays symbolic)', () => {
      const ce = new ComputeEngine();
      // Use 'I' instead of 'D' (D might be reserved)
      ce.declareSequence('I', {
        variables: ['n', 'k'],
        base: { '0,0': 1, 'n,0': 1, 'n,n': 1 },
        recurrence: 'I_{n-1,k-1} + I_{n-1,k}',
        domain: { n: { min: 0 }, k: { min: 0 } },
        constraints: 'k \\le n',
      });

      // Valid: k <= n
      expect(ce.parse('I_{3,2}').evaluate().re).toBe(3);

      // Invalid: k > n (constraint violation)
      const invalid = ce.parse('I_{3,5}').evaluate();
      expect(invalid.operator).toBe('Subscript'); // Stays symbolic
    });

    test('Negative index with domain constraint', () => {
      const ce = new ComputeEngine();
      // Use 'b' as sequence name and unique variable names
      ce.declareSequence('b', {
        variables: ['m', 'n'],
        base: { '0,0': 1, 'm,0': 1, '0,n': 1 },
        recurrence: 'b_{m-1,n} + b_{m,n-1}',
        domain: { m: { min: 0 }, n: { min: 0 } },
      });

      // Valid
      expect(ce.parse('b_{2,2}').evaluate().re).toBe(6);

      // Invalid: negative index
      const invalid = ce.parse('b_{-1,2}').evaluate();
      expect(invalid.operator).toBe('Subscript');
    });
  });

  describe('Introspection for multi-index sequences', () => {
    test('getSequence returns multi-index info', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('M', {
        variables: ['a', 'b'],
        base: { '0,0': 1, 'a,0': 1 },
        recurrence: 'M_{a-1,b} + 1',
      });

      const info = ce.getSequence('M');
      expect(info).toBeDefined();
      expect(info!.name).toBe('M');
      expect(info!.isMultiIndex).toBe(true);
      expect(info!.variables).toEqual(['a', 'b']);
      expect(info!.baseIndices).toContain('0,0');
      expect(info!.baseIndices).toContain('a,0');
    });

    test('isSequence works for multi-index', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('N', {
        variables: ['x', 'y'],
        base: { '0,0': 0 },
        recurrence: 'N_{x-1,y} + N_{x,y-1}',
      });

      expect(ce.isSequence('N')).toBe(true);
      expect(ce.isSequence('NotASequence')).toBe(false);
    });

    test('listSequences includes multi-index sequences', () => {
      const ce = new ComputeEngine();
      // Use single letters - multi-letter names are parsed as products in LaTeX
      ce.declareSequence('K', {
        base: { 0: 1 },
        recurrence: 'K_{n-1} + 1',
      });
      ce.declareSequence('L', {
        variables: ['i', 'j'],
        base: { '0,0': 1 },
        recurrence: 'L_{i-1,j} + L_{i,j-1}',
      });

      const sequences = ce.listSequences();
      expect(sequences).toContain('K');
      expect(sequences).toContain('L');
    });

    test('getSequenceStatus for pending multi-index', () => {
      const ce = new ComputeEngine();
      // Only base case, no recurrence yet
      ce.parse('W_{0,0} := 1').evaluate();

      const status = ce.getSequenceStatus('W');
      expect(status.status).toBe('pending');
      expect(status.hasBase).toBe(true);
      expect(status.hasRecurrence).toBe(false);
    });
  });

  describe('Pattern matching edge cases', () => {
    test('Exact match takes priority over pattern', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('X', {
        variables: ['n', 'k'],
        base: {
          '3,3': 999, // Specific override for (3,3)
          'n,n': 1, // General diagonal pattern
          'n,0': 1,
          '0,0': 1,
        },
        recurrence: 'X_{n-1,k-1} + X_{n-1,k}',
      });

      // Exact match should take priority
      expect(ce.parse('X_{3,3}').evaluate().re).toBe(999);
      // Pattern match for other diagonal elements
      expect(ce.parse('X_{5,5}').evaluate().re).toBe(1);
      expect(ce.parse('X_{2,2}').evaluate().re).toBe(1);
    });

    test('Pattern with repeated variable requires equal indices', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('Y', {
        variables: ['n', 'k'],
        base: {
          'n,n': 100, // Only matches when n == k
          'n,0': 1,
          '0,k': 1,
        },
        recurrence: 'Y_{n-1,k-1} + Y_{n-1,k}',
      });

      // n,n pattern matches only when indices are equal
      expect(ce.parse('Y_{4,4}').evaluate().re).toBe(100);
      expect(ce.parse('Y_{7,7}').evaluate().re).toBe(100);

      // n,0 pattern matches second index = 0
      expect(ce.parse('Y_{5,0}').evaluate().re).toBe(1);

      // 0,k pattern matches first index = 0
      expect(ce.parse('Y_{0,3}').evaluate().re).toBe(1);
    });
  });

  describe('Arithmetic with multi-index sequences', () => {
    test('Add and multiply multi-index sequence values', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('B', {
        variables: ['n', 'k'],
        base: { '0,0': 1, 'n,0': 1, 'n,n': 1 },
        recurrence: 'B_{n-1,k-1} + B_{n-1,k}',
      });

      // B_{5,2} = 10, B_{4,2} = 6
      const sum = ce.parse('B_{5,2} + B_{4,2}').evaluate();
      expect(sum.re).toBe(16);

      const product = ce.parse('B_{5,2} \\cdot B_{4,2}').evaluate();
      expect(product.re).toBe(60);
    });

    test('Use in expressions', () => {
      const ce = new ComputeEngine();
      ce.declareSequence('C', {
        variables: ['n', 'k'],
        base: { '0,0': 1, 'n,0': 1, 'n,n': 1 },
        recurrence: 'C_{n-1,k-1} + C_{n-1,k}',
      });

      // 2 * C_{4,2} + 3 = 2 * 6 + 3 = 15
      const result = ce.parse('2 C_{4,2} + 3').evaluate();
      expect(result.re).toBe(15);
    });
  });
});

// ============================================================================
// SEQUENCE TYPE INFERENCE
// ============================================================================

describe('SEQUENCE TYPE INFERENCE', () => {
  const ce = new ComputeEngine();

  test('Empty Sequence has type nothing', () => {
    const seq = ce.expr(['Sequence']);
    expect(seq.type.toString()).toBe('nothing');
  });

  test('Single-argument Sequence inherits argument type', () => {
    const seq = ce.expr(['Sequence', 1]);
    expect(seq.type.toString()).toMatch(/integer/);
  });

  test('Multi-argument homogeneous Sequence returns tuple type', () => {
    const seq = ce.expr(['Sequence', 1, 2, 3]);
    const t = seq.type.toString();
    expect(t).toContain('tuple');
    expect(t).toContain('integer');
  });

  test('Multi-argument heterogeneous Sequence preserves element types', () => {
    const seq = ce.expr(['Sequence', 1, { str: 'hello' }]);
    const t = seq.type.toString();
    expect(t).toContain('tuple');
    expect(t).toContain('integer');
    expect(t).toContain('string');
  });

  test('Sequence type is not "any" for multiple arguments', () => {
    const seq = ce.expr(['Sequence', 1, 2]);
    expect(seq.type.toString()).not.toBe('any');
  });
});
