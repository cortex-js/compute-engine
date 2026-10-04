import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

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
      // Without memoization the naive recurrence makes 2³⁰ calls, which does
      // not finish; with it, M₃₀ costs 30 steps. So obtaining the value at all
      // is the assertion, and the jest per-test timeout below is the backstop
      // for the un-memoized case. An elapsed-millisecond budget would have
      // reported how loaded the machine was instead.
      const result = ce.parse('M_{30}').evaluate().re;
      expect(result).toBe(832040);
    }, 60_000);

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

    // Note: Avoid 'E' (Euler's number) and 'D' (derivative)
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
    expectTypeBetween(seq, { atMost: 'integer' });
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

describe('SEQUENCE MEMO: numeric terms are remembered for one precision', () => {
  // A term computed by a numeric approximation is remembered with the
  // precision: a term at 21 digits is not the value of `N(B_10, 50)`, and a
  // float term is not the value of an exact evaluation. The digits are from
  // mpmath: B_10 = π^10/10!.
  const B_10_50 = '0.025806891390014060012598294252898849657186441048147';
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareSequence('B', {
      base: { 0: 1 },
      recurrence: '\\frac{\\pi B_{n-1}}{n}',
    });
    return ce;
  }
  const term = (ce: ComputeEngine) => ce.parse('B_{10}').json;

  test('N(B_10) then N(B_10, 50)', () => {
    const ce = engine();
    expect(ce.box(['N', term(ce)]).evaluate().toString()).toBe(
      '0.0258068913900140600126'
    );
    expect(ce.box(['N', term(ce), 50]).evaluate().json).toEqual({
      num: B_10_50,
    });
  });

  test('N(B_10, 50) then N(B_10)', () => {
    const ce = engine();
    expect(ce.box(['N', term(ce), 50]).evaluate().json).toEqual({
      num: B_10_50,
    });
    // The term at the precision of the engine (21 digits), not the
    // 50-digit term.
    expect(ce.parse('B_{10}').N().toString()).toBe(
      '0.0258068913900140600126'
    );
  });

  test('an exact evaluation after .N() is not a float', () => {
    const ce = engine();
    expect(ce.parse('B_{10}').N().isExact).toBe(false);
    const exact = ce.parse('B_{10}').evaluate();
    expect(exact.isNumberLiteral && !exact.isExact).toBe(false);
  });

  test('getSequenceCache() shows only the exact terms', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    // The numeric terms are in a separate map: no key after `.N()` reads.
    expect(ce.parse('F_{6}').N().re).toBe(8);
    expect(ce.box(['N', ce.parse('F_{6}').json, 50]).evaluate().re).toBe(8);
    expect([...ce.getSequenceCache('F')!.keys()]).toEqual([]);
    // The exact terms have the index as their key.
    expect(ce.parse('F_{6}').evaluate().re).toBe(8);
    expect([...ce.getSequenceCache('F')!.keys()].sort()).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  test('clearSequenceCache() clears the numeric terms', () => {
    const ce = engine();
    const before = ce.parse('B_{10}').N();
    // A memo hit returns the same object.
    expect(ce.parse('B_{10}').N()).toBe(before);
    ce.clearSequenceCache('B');
    // After the clear, the term is computed again: a new object.
    const after = ce.parse('B_{10}').N();
    expect(after).not.toBe(before);
    expect(after.isSame(before)).toBe(true);
  });
});

describe('SEQUENCE EXACT TERMS: evaluate() returns an exact term', () => {
  // `evaluate()` returns the exact form of a term also when the term is not
  // a single number literal. `.N()` gives a float, as before.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    // B_n = π^n/n!
    ce.declareSequence('B', {
      base: { 0: 1 },
      recurrence: '\\frac{\\pi B_{n-1}}{n}',
    });
    // a_n = 1 + n√2
    ce.declareSequence('a', {
      base: { 0: 1 },
      recurrence: 'a_{n-1} + \\sqrt{2}',
    });
    // c_n = x·c_{n-1} + 1, a recurrence over the free symbol x
    ce.declareSequence('c', {
      base: { 0: 1 },
      recurrence: 'x c_{n-1} + 1',
    });
    return ce;
  }

  test('B_10 is π^10/10!', () => {
    const ce = engine();
    const term = ce.parse('B_{10}').evaluate();
    expect(term.json).toEqual([
      'Multiply',
      ['Rational', 1, 3628800],
      ['Power', 'Pi', 10],
    ]);
    expect(term.isSame(ce.parse('\\frac{\\pi^{10}}{10!}').evaluate())).toBe(
      true
    );
    // The digits are from mpmath.
    expect(ce.box(['N', term.json, 50]).evaluate().json).toEqual({
      num: '0.025806891390014060012598294252898849657186441048147',
    });
    // The float term of `.N()` is computed by the recurrence, one float
    // operation at each level, so only its first digits are compared.
    expect(ce.parse('B_{10}').N().re).toBeCloseTo(term.N().re, 15);
  });

  test('a_10 is 1 + 10√2', () => {
    const ce = engine();
    const term = ce.parse('a_{10}').evaluate();
    expect(term.toString()).toBe('1 + 10sqrt(2)');
    expect(term.isSame(ce.parse('1 + 10\\sqrt{2}').evaluate())).toBe(true);
    expect(ce.parse('a_{10}').N().re).toBeCloseTo(1 + 10 * Math.SQRT2, 14);
    expect(term.N().re).toBeCloseTo(1 + 10 * Math.SQRT2, 14);
  });

  test('a term over a free symbol, below the size limit', () => {
    const ce = engine();
    // c_1 = x + 1, c_2 = x(x + 1) + 1, c_3 = x(x(x + 1) + 1) + 1
    expect(ce.parse('c_{3}').evaluate().toString()).toBe(
      'x * (x * (x + 1) + 1) + 1'
    );
    // `c_n` has 4n − 1 nodes: `c_62` (247 nodes) is below the limit.
    expect(ce.parse('c_{62}').evaluate().operator).toBe('Add');
    // `.N()` has no float for a term with a free symbol.
    expect(ce.parse('c_{3}').N().operator).toBe('Subscript');
  });

  test('a term over a free symbol, above the size limit', () => {
    const ce = engine();
    // `c_63` has 251 nodes: it stays unevaluated, and so does every term
    // above it, because it contains `c_63`.
    expect(ce.parse('c_{63}').evaluate().toString()).toBe('Subscript(c, 63)');
    expect(ce.parse('c_{100}').evaluate().toString()).toBe(
      'Subscript(c, 100)'
    );
  });

  test('a term over a free symbol is memoized until the symbol changes', () => {
    const ce = engine();
    expect(ce.parse('c_{3}').evaluate().operator).toBe('Add');
    expect(ce.getSequenceCache('c')!.size).toBeGreaterThan(0);
    // After an assignment, the term is computed again with the value.
    ce.assign('x', 2);
    expect(ce.parse('c_{3}').evaluate().json).toBe(15);
  });

  test('a large index: each term is computed one time', () => {
    const ce = engine();
    const b100 = ce.parse('B_{100}').evaluate();
    expect(
      b100.isSame(ce.parse('\\frac{\\pi^{100}}{100!}').evaluate())
    ).toBe(true);
    // One memo entry for each of B_1 … B_100 (a base case is not memoized).
    expect(ce.getSequenceCache('B')!.size).toBe(100);
    // A second read is a memo hit: the same term, and no new entry.
    expect(ce.parse('B_{100}').evaluate()).toBe(b100);
    expect(ce.getSequenceCache('B')!.size).toBe(100);

    expect(ce.parse('a_{100}').evaluate().toString()).toBe('1 + 100sqrt(2)');
    expect(ce.getSequenceCache('a')!.size).toBe(100);
  });

  test('evaluate() after .N() returns the exact term', () => {
    const ce = engine();
    const float = ce.parse('B_{10}').N();
    expect(float.isNumberLiteral && !float.isExact).toBe(true);
    expect(ce.parse('B_{10}').evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 3628800],
      ['Power', 'Pi', 10],
    ]);
  });

  test('.N() after evaluate() returns a float', () => {
    const ce = engine();
    expect(ce.parse('a_{10}').evaluate().toString()).toBe('1 + 10sqrt(2)');
    const float = ce.parse('a_{10}').N();
    expect(float.isNumberLiteral && !float.isExact).toBe(true);
    expect(float.re).toBeCloseTo(1 + 10 * Math.SQRT2, 14);
    // The numeric terms are not in the cache of the exact terms.
    const keys = [...ce.getSequenceCache('a')!.keys()];
    expect(keys.length).toBe(10);
    expect(keys.every((k) => typeof k === 'number')).toBe(true);
  });

  test('an inexact recurrence gives a float', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('h', {
      base: { 0: 1 },
      recurrence: 'h_{n-1} + 0.1\\sqrt{2}',
    });
    const term = ce.parse('h_{3}').evaluate();
    expect(term.isNumberLiteral && !term.isExact).toBe(true);
    expect(term.re).toBeCloseTo(1 + 0.3 * Math.SQRT2, 14);
  });
});

describe('SEQUENCE MEMO: cold reads, outdated terms and declined terms', () => {
  test('a cold read of a large index does not overflow the stack', () => {
    // The lower terms are computed from the lowest up, so the recursion
    // does not go one level deeper for each index (before, a cold read of
    // F_500 exceeded the call stack). The digits are from an exact
    // computation in Python: F_1000 has 209 digits.
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    const exact = ce.parse('F_{1000}').evaluate().toString();
    expect(exact.length).toBe(209);
    expect(exact.startsWith('434665576869374564356885276750')).toBe(true);
    expect(exact.endsWith('166849228875')).toBe(true);

    const ce2 = new ComputeEngine();
    ce2.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(
      ce2.parse('F_{1000}').N().toString().startsWith('434665576869374')
    ).toBe(true);
  });

  test('a recurrence with a step of 2 computes one parity only', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('a', {
      base: { 0: 0, 1: 1 },
      recurrence: 'a_{n-2} + 2',
    });
    expect(ce.parse('a_{1001}').evaluate().json).toBe(1001);
    // a_3, a_5, …, a_1001
    expect(ce.getSequenceCache('a')!.size).toBe(500);
  });

  test('a recurrence that halves the index computes only the terms it reads', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('h', {
      base: { 0: 0 },
      recurrence: 'h_{\\lfloor n/2 \\rfloor} + 1',
    });
    expect(ce.parse('h_{1000000}').evaluate().json).toBe(20);
    expect(ce.getSequenceCache('h')!.size).toBe(20);
  });

  test('an assignment to a symbol of the recurrence makes the memo outdated', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('c', { base: { 0: 1 }, recurrence: 'x c_{n-1} + 1' });
    ce.assign('x', 2);
    expect(ce.parse('c_{3}').evaluate().json).toBe(15);
    expect(ce.parse('c_{3}').N().re).toBe(15);
    ce.assign('x', 3);
    expect(ce.parse('c_{3}').evaluate().json).toBe(40);
    expect(ce.parse('c_{3}').N().re).toBe(40);
    // .N() first, then evaluate()
    ce.assign('x', 4);
    expect(ce.parse('c_{3}').N().re).toBe(85);
    expect(ce.parse('c_{3}').evaluate().json).toBe(85);
  });

  test('a term is computed one time while the symbols it reads are unchanged', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('f', {
      signature: '(integer) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        calls += 1;
        return ops[0];
      },
    });
    ce.declareSequence('K', { base: { 0: 0 }, recurrence: 'K_{n-1} + f(n)' });
    expect(ce.parse('K_{10}').evaluate().json).toBe(55);
    expect(calls).toBe(10);
    expect(ce.parse('K_{10}').evaluate().json).toBe(55);
    // An assignment to a symbol that the recurrence does not read
    ce.assign('z', 5);
    expect(ce.parse('K_{10}').evaluate().json).toBe(55);
    expect(calls).toBe(10);
    expect(ce.parse('K_{10}').N().re).toBe(55);
    expect(ce.parse('K_{10}').N().re).toBe(55);
    expect(calls).toBe(20);
  });

  test('a declined term is computed one time', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('f', {
      signature: '(integer) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        calls += 1;
        return ce.number(1);
      },
    });
    // The terms grow over the free symbol `y` and are declined above the
    // size limit. The recurrence reads two lower terms: if a declined term
    // is computed again at each read, the work doubles at each index.
    ce.declareSequence('G', {
      base: { 0: 1, 1: 1 },
      recurrence: 'G_{n-1} + y f(n) G_{n-2}',
    });
    expect(ce.parse('G_{30}').evaluate().operator).toBe('Subscript');
    // G_2 … G_30: 29 terms. One more when the first evaluation changes the
    // state of the engine (the type of `y` is inferred).
    expect(calls).toBeLessThanOrEqual(2 * 30);
    calls = 0;
    expect(ce.parse('G_{30}').N().operator).toBe('Subscript');
    expect(calls).toBeLessThanOrEqual(2 * 30);

    // A recurrence that reads the same lower term two times
    calls = 0;
    ce.declareSequence('d', {
      base: { 0: ce.parse('w') },
      recurrence: 'd_{n-1}(d_{n-1} + f(n))',
    });
    expect(ce.parse('d_{12}').evaluate().operator).toBe('Subscript');
    expect(calls).toBeLessThanOrEqual(2 * 12);
  });
});

describe('SEQUENCE TERMS: computed on demand', () => {
  // A cold read computes the lower terms that the recurrence reads, with
  // a stack of the terms whose computation is not complete: only the terms
  // that the recurrence reads are computed, each one time, and the depth of
  // the JavaScript calls does not grow with the index.

  test('an index that is not a safe integer is declined', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('f', {
      signature: '(integer) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        calls += 1;
        return ce.number(1);
      },
    });
    ce.declareSequence('A', { base: { 0: 0 }, recurrence: 'A_{n-1} + f(n)' });
    // `1e20 − 1` is `1e20`: before, the read did not stop.
    expect(ce.box(['Subscript', 'A', 1e20]).evaluate().operator).toBe(
      'Subscript'
    );
    expect(calls).toBe(0);
  });

  test('a term in a branch that is not taken is not computed', () => {
    const ce = new ComputeEngine();
    let draws = 0;
    ce.declare('draw', {
      signature: '(integer) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        draws += 1;
        return ce.number(1);
      },
    });
    ce.declareSequence('A', {
      base: { 0: 0 },
      recurrence: '\\operatorname{If}(n = 1000, 7, A_{n-1} + \\operatorname{draw}(n))',
    });
    // Before, A_1 … A_999 were computed: 999 draws.
    expect(ce.parse('A_{1000}').evaluate().json).toBe(7);
    expect(draws).toBe(0);
    // A taken branch computes the terms it reads, each one time.
    expect(ce.parse('A_{5}').evaluate().json).toBe(5);
    expect(draws).toBe(5);

    // The same with `Random()` in a seeded frame: reading R_1000 consumes
    // no draw, and reading S_5 consumes 5 draws.
    ce.declareSequence('R', {
      base: { 0: 0 },
      recurrence:
        '\\operatorname{If}(n = 1000, 7, R_{n-1} + \\operatorname{Random}())',
    });
    ce.declareSequence('S', {
      base: { 0: 0 },
      recurrence: 'S_{n-1} + \\operatorname{Random}()',
    });
    const stream = ce
      .box(['WithRandomSeed', 1, ['Tuple', ...Array(6).fill(['Random'])]])
      .evaluate();
    const r = ce
      .box(['WithRandomSeed', 1, ['Tuple', ['Subscript', 'R', 1000], ['Random']]])
      .evaluate();
    expect(r.op1.json).toBe(7);
    expect(r.op2.re).toBe(stream.ops[0].re);
    const s = ce
      .box(['WithRandomSeed', 1, ['Tuple', ['Subscript', 'S', 5], ['Random']]])
      .evaluate();
    const firstFive = stream.ops.slice(0, 5).reduce((t, x) => t + x.re, 0);
    expect(s.op1.re).toBeCloseTo(firstFive, 12);
    expect(s.op2.re).toBe(stream.ops[5].re);
  });

  test('a term whose computation changes a symbol that the recurrence reads', () => {
    // Each term changes `s`, which the recurrence reads: the memo is
    // outdated after each term. The terms computed in the read are not
    // computed again (before, `a_10` took 5157 calls of `w`).
    const ce = new ComputeEngine();
    let calls = 0;
    ce.assign('s', 0);
    ce.declare('w', {
      signature: '(integer, number) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        calls += 1;
        ce.assign('s', calls);
        return ce.number(0);
      },
    });
    ce.declareSequence('a', {
      base: { 0: 0, 1: 1 },
      recurrence: 'a_{n-1} + a_{n-2} + w(n, s)',
    });
    expect(ce.parse('a_{10}').evaluate().json).toBe(55);
    expect(calls).toBeLessThanOrEqual(2 * 10);
    calls = 0;
    expect(ce.parse('a_{30}').evaluate().json).toBe(832040);
    expect(calls).toBeLessThanOrEqual(2 * 30);
  });

  test('a cold read of F_2000', () => {
    // The digits are from an exact computation in Python.
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    const exact = ce.parse('F_{2000}').evaluate().toString();
    expect(exact.length).toBe(418);
    expect(exact.startsWith('422469633339230487870672560234')).toBe(true);
    expect(exact.endsWith('082516817125')).toBe(true);
  });

  test('two sequences that read each other', () => {
    // Before, each term was computed by a nested read of the other
    // sequence, and a cold read of a large index exceeded the call stack.
    const ce = new ComputeEngine();
    ce.declareSequence('E', { base: { 0: 0 }, recurrence: 'O_{n-1} + 1' });
    ce.declareSequence('O', { base: { 0: 0 }, recurrence: 'E_{n-1} + 1' });
    expect(ce.parse('E_{3000}').evaluate().json).toBe(3000);
  });

  test('a term that reads itself is declined', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('Y', { base: { 0: 0 }, recurrence: 'Y_{n} + 1' });
    expect(ce.parse('Y_{5}').evaluate().operator).toBe('Subscript');
  });

  test('a read that needs more than 100,000 terms is declined', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('A', { base: { 0: 0 }, recurrence: 'A_{n-1} + 1' });
    expect(ce.parse('A_{100500}').evaluate().operator).toBe('Subscript');
    // The read stops before it computes a term.
    expect(ce.getSequenceCache('A')!.size).toBe(0);
    expect(ce.parse('A_{10}').evaluate().json).toBe(10);
  });

  test('an exact term that contains a float is remembered for one precision', () => {
    // mpmath: 1 + 0.3·√2
    const ce = new ComputeEngine();
    ce.declareSequence('h', {
      base: { 0: 1 },
      recurrence: 'h_{n-1} + 0.1\\sqrt{2}',
    });
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', ['Subscript', 'h', 'k'], 'k']));
    expect(ce.box(['N', ['g', 3], 50]).evaluate().toString()).toBe(
      '1.4242640687119285146405066172629094235709015626131'
    );
    // Not the 55-digit term computed for `N(g(3), 50)`
    expect(ce.parse('h_{3}').evaluate().toString()).toBe(
      '1.42426406871192851464'
    );
    // The terms with a float are not in the cache of the exact terms.
    expect(ce.getSequenceCache('h')!.size).toBe(0);
  });

  test('a base value is evaluated when it is read', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('b', {
      base: { 0: ce.box('s') },
      recurrence: 'b_{n-1} + 1',
    });
    ce.assign('s', 10);
    // Before, `b_3` was `s + 3`.
    expect(ce.parse('b_{3}').evaluate().json).toBe(13);
    expect(ce.parse('b_{0}').evaluate().json).toBe(10);
    ce.assign('s', 20);
    expect(ce.parse('b_{3}').evaluate().json).toBe(23);
    expect(ce.parse('b_{3}').N().re).toBe(23);

    // An exact base value stays exact under `evaluate()`
    ce.declareSequence('p', {
      base: { 0: ce.box('Pi') },
      recurrence: 'p_{n-1} + 1',
    });
    expect(ce.parse('p_{2}').evaluate().toString()).toBe('2 + pi');
    // Before, `.N()` of `p_2` stayed unevaluated.
    expect(ce.parse('p_{2}').N().toString()).toBe('5.14159265358979323846');
  });
});

describe('SEQUENCE TERMS: side effects of the recurrence', () => {
  // A cold read of a pure sequence can stop the computation of a term and
  // do it again (see "computed on demand" above). A sequence whose
  // recurrence has side effects (an assignment, `Print`, `Random()`, a
  // function declared `pure: false`) is computed recursively instead: each
  // term one time, so each side effect occurs one time for each term.

  /** A function with a side effect: it records each argument. */
  function declareBump(ce: ComputeEngine, calls: number[]): void {
    ce.declare('bump', {
      signature: '(integer) -> integer',
      pure: false,
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        calls.push(ops[0].re);
        return ce.number(1);
      },
    });
  }

  test('an assignment in the recurrence occurs one time for each term', () => {
    const ce = new ComputeEngine();
    ce.assign('c', 0);
    ce.declareSequence('s', {
      base: { 0: 0 },
      recurrence:
        '\\operatorname{Block}(\\operatorname{Assign}(c, c+1), s_{n-1}+1)',
    });
    expect(ce.parse('s_{10}').evaluate().json).toBe(10);
    // Before, `c` was 19: the computations that were stopped were done
    // again, with their assignments.
    expect(ce.box('c').evaluate().json).toBe(10);
  });

  test('a function with a side effect is called one time for each term', () => {
    const ce = new ComputeEngine();
    const calls: number[] = [];
    declareBump(ce, calls);
    ce.declareSequence('A', {
      base: { 0: 0 },
      recurrence:
        '\\operatorname{Block}(\\operatorname{bump}(n), A_{\\lfloor n/2 \\rfloor} + 1)',
    });
    // Before, `bump(2)` was called two times.
    expect(ce.parse('A_{2}').evaluate().json).toBe(2);
    expect(calls).toEqual([2, 1]);
    calls.length = 0;
    expect(ce.parse('A_{1000}').evaluate().json).toBe(10);
    expect(calls).toEqual([1000, 500, 250, 125, 62, 31, 15, 7, 3]);
    calls.length = 0;
    expect(ce.parse('A_{1000}').evaluate().json).toBe(10);
    expect(calls).toEqual([]);
  });

  test('a pure recurrence that reads a sequence with side effects', () => {
    // The recurrence of `F` is pure, but it reads `I`, whose recurrence
    // calls `bump`. The terms of `I` are not memoized, so a second
    // computation of a term of `F` would compute its term of `I` again.
    // A computation that computed a term of `I` is not stopped: the lower
    // term of `F` is computed recursively.
    const ce = new ComputeEngine();
    const calls: number[] = [];
    declareBump(ce, calls);
    ce.declareSequence('I', {
      base: { 0: 0 },
      memoize: false,
      recurrence: 'I_{n-1} + \\operatorname{bump}(n)',
    });
    ce.declareSequence('F', {
      base: { 0: 0 },
      recurrence: '\\operatorname{Block}(I_{n}, F_{\\lfloor n/2\\rfloor} + 1)',
    });
    expect(ce.parse('F_{8}').evaluate().json).toBe(4);
    // I_8, I_4, I_2 and I_1: 8 + 4 + 2 + 1 calls. Before, 29.
    expect(calls.length).toBe(15);
  });

  test('a random draw used by a nested read is not given again', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('S', {
      base: { 0: 0 },
      recurrence: 'S_{n-1} + \\operatorname{Random}()',
    });
    ce.declareSequence('R', {
      base: { 0: 0 },
      recurrence:
        '\\operatorname{If}(n > 0, \\operatorname{Block}(\\operatorname{Assign}(u, S_{n}), u + R_{n-1}), 0)',
    });
    const d = ce
      .box(['WithRandomSeed', 1, ['Tuple', ['Random'], ['Random'], ['Random']]])
      .evaluate()
      .ops.map((x) => x.re);
    const r = ce
      .box(['WithRandomSeed', 1, ['Tuple', ['Subscript', 'R', 2], ['Random']]])
      .evaluate();
    // R_2 = S_2 + S_1 = (d1 + d2) + d1
    expect(r.op1.re).toBeCloseTo(2 * d[0] + d[1], 12);
    // Before, the trailing draw was d1, which S_1 used.
    expect(r.op2.re).toBe(d[2]);
  });

  test('an index that is not affine is not computed in advance', () => {
    // For n < 10, the index is 0: only A_0 is read. Before, the index
    // looked like `n − 1` (its value at large n), and a read of A_5 also
    // computed A_1 … A_4.
    const ce = new ComputeEngine();
    const draws: number[] = [];
    ce.declare('draw', {
      signature: '(integer) -> integer',
      evaluate: (ops) => {
        if (!ops[0].isNumberLiteral) return undefined;
        draws.push(ops[0].re);
        return ce.number(1);
      },
    });
    ce.declareSequence('A', {
      base: { 0: 0 },
      recurrence:
        'A_{\\operatorname{If}(n < 10, 0, n - 1)} + \\operatorname{draw}(n)',
    });
    expect(ce.parse('A_{5}').evaluate().json).toBe(1);
    expect(draws).toEqual([5]);
    expect([...ce.getSequenceCache('A')!.keys()]).toEqual([5]);
  });

  test('a constraint that reads the sequence', () => {
    // The check of the constraint of A_9 reads A_7, which is not known
    // yet. Before, the read threw an object, and each later read of a
    // sequence threw it again.
    const ce = new ComputeEngine();
    ce.declareSequence('A', {
      base: { 0: 0 },
      domain: { min: 0 },
      recurrence: 'A_{n-1} + 1',
      constraints: 'n \\le 1 \\lor n = 10 \\lor A_{n-2} \\ge 0',
    });
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(ce.parse('A_{10}').evaluate().json).toBe(10);
    expect(ce.parse('F_{10}').evaluate().json).toBe(55);
  });

  test('a constraint that reads the term that it checks', () => {
    // The check of P_{2,1} reads P_{2,1}: the index is not valid. Before,
    // the check started again with no end, and exceeded the call stack.
    const ce = new ComputeEngine();
    ce.declareSequence('P', {
      variables: ['n', 'k'],
      base: { 'n,0': 1, 'n,n': 1 },
      recurrence: 'P_{n-1,k-1} + P_{n-1,k}',
      constraints: 'P_{n-1, 0} + P_{2,1} > 0',
    });
    expect(ce.parse('P_{5,2}').evaluate().operator).toBe('Subscript');
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(ce.parse('F_{10}').evaluate().json).toBe(55);
  });

  test('a recursion that is too deep is declined', () => {
    // A recursive computation deeper than 100 terms stops before it
    // exceeds the call stack (before, `H_{500}` threw a RangeError). The
    // term is declined, and no term is memoized as declined: after reads
    // of lower indices, the same read gives the term.
    const ce = new ComputeEngine();
    const calls: number[] = [];
    declareBump(ce, calls);
    ce.declareSequence('H', {
      base: { 0: 0 },
      recurrence: 'H_{n-1} + \\operatorname{bump}(n)',
    });
    expect(ce.parse('H_{500}').evaluate().operator).toBe('Subscript');
    expect(calls.length).toBeLessThanOrEqual(100);
    expect(ce.getSequenceCache('H')!.size).toBe(0);
    // A later read of another sequence is not changed.
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(ce.parse('F_{10}').evaluate().json).toBe(55);
    for (let n = 90; n <= 500; n += 90)
      expect(ce.parse(`H_{${n}}`).evaluate().json).toBe(n);
    expect(ce.parse('H_{500}').evaluate().json).toBe(500);
  });

  test('a symbol whose value has a side effect makes the recurrence impure', () => {
    // `r` holds `Assign(c, c + 1)`, not evaluated: each read of `r`
    // evaluates it. The recurrence `r + Q_{⌊n/2⌋}` is pure (`isPure`), but
    // what it reads is not. Before, the computation of a term was stopped
    // and done again, and `c` was 7 after a read of Q_8 (4 terms).
    const ce = new ComputeEngine();
    ce.assign('c', 0);
    ce.declare('r', {
      value: ce.box(['Assign', 'c', ['Add', 'c', 1]], { form: 'raw' }),
    });
    ce.declareSequence('Q', {
      base: { 0: 0 },
      recurrence: 'r + Q_{\\lfloor n/2 \\rfloor}',
    });
    // Q_8, Q_4, Q_2 and Q_1 each read `r` one time: 1 + 2 + 3 + 4.
    expect(ce.parse('Q_{8}').evaluate().json).toBe(10);
    expect(ce.box('c').evaluate().json).toBe(4);
  });

  test('a function that reads a stopped term is not memoized', () => {
    // A read of H_500 is stopped (the recursion is too deep): the term is
    // declined for this read only. Before, the memo of the applications
    // of `g` kept the declined term, and `g(500)` stayed `H_500` after
    // the reads of the lower indices.
    const ce = new ComputeEngine();
    const calls: number[] = [];
    declareBump(ce, calls);
    ce.declareSequence('H', {
      base: { 0: 0 },
      recurrence: 'H_{n-1} + \\operatorname{bump}(n)',
    });
    ce.parse('g := k \\mapsto H_k').evaluate();
    expect(ce.parse('g(500)').evaluate().operator).toBe('Subscript');
    for (let n = 90; n <= 450; n += 90)
      expect(ce.parse(`H_{${n}}`).evaluate().json).toBe(n);
    expect(ce.parse('g(500)').evaluate().json).toBe(500);
  });

  test('two engines, and an error in a read', () => {
    // The state of the reads in progress is for the process. A stopped
    // read and an error thrown in a read leave no state that changes a
    // later read, in the same engine or in another engine.
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();
    let fail = true;
    ce1.declare('boom', {
      signature: '(integer) -> integer',
      pure: false,
      evaluate: (ops) => {
        if (fail && ops[0].re === 50) {
          fail = false;
          throw new Error('boom');
        }
        return ce1.number(1);
      },
    });
    ce1.declareSequence('T', {
      base: { 0: 0 },
      recurrence: 'T_{n-1} + \\operatorname{boom}(n)',
    });
    ce2.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(() => ce1.parse('T_{60}').evaluate()).toThrow('boom');
    expect(ce2.parse('F_{30}').evaluate().json).toBe(832040);
    expect(ce1.parse('T_{60}').evaluate().json).toBe(60);
    // A stop in one engine, then a read in the other engine.
    expect(ce1.parse('T_{500}').evaluate().operator).toBe('Subscript');
    expect(ce2.parse('F_{2000}').evaluate().isNumberLiteral).toBe(true);
    expect(ce1.parse('T_{150}').evaluate().json).toBe(150);
  });
});

describe('SEQUENCE MEMO: what the memo stamp records', () => {
  test('an assignment to a symbol of the constraints makes the memo outdated', () => {
    // G_{1,0} is valid only while w > 0. Before, the stamp recorded the
    // recurrence and the base values only, and G_{2,0} stayed 2 when
    // G_{1,0} was no longer valid.
    const ce = new ComputeEngine();
    ce.assign('w', 1);
    ce.declareSequence('G', {
      variables: ['n', 'k'],
      base: { '0,0': 0 },
      recurrence: 'G_{n-1,k} + 1',
      constraints: 'n = 0 \\lor n = 2 \\lor w > 0',
    });
    expect(ce.parse('G_{2,0}').evaluate().json).toBe(2);
    ce.assign('w', -1);
    expect(ce.parse('G_{1,0}').evaluate().operator).toBe('Subscript');
    expect(ce.parse('G_{2,0}').evaluate().operator).toBe('Subscript');
    ce.assign('w', 1);
    expect(ce.parse('G_{2,0}').evaluate().json).toBe(2);
  });

  test('a symbol that another sequence reads makes the memo outdated', () => {
    // The recurrence of A reads B, and the handler of B reads x. Before,
    // the stamp of A did not show x, and A_2 stayed 2 when B_2 was 4.
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declareSequence('B', { base: { 0: 0 }, recurrence: 'B_{n-1} + x' });
    ce.declareSequence('A', { base: { 0: 0 }, recurrence: 'B_n' });
    ce.declareSequence('C', { base: { 0: 0 }, recurrence: 'A_n + 1' });
    expect(ce.parse('A_{2}').evaluate().json).toBe(2);
    expect(ce.parse('C_{2}').evaluate().json).toBe(3);
    ce.assign('x', 2);
    expect(ce.parse('A_{2}').evaluate().json).toBe(4);
    expect(ce.parse('C_{2}').evaluate().json).toBe(5);
  });
});

describe('SEQUENCE TERMS: caches outside the sequence', () => {
  function declareBump(ce: ComputeEngine): void {
    ce.declare('bump', {
      signature: '(integer) -> integer',
      pure: false,
      evaluate: (ops) => (ops[0].isNumberLiteral ? ce.number(1) : undefined),
    });
  }

  /** A sequence whose read of `H_500` is stopped (the recursion is too
   * deep), and that gives `H_500` after the reads of the lower indices. */
  function declareDeepSequence(ce: ComputeEngine): void {
    declareBump(ce);
    ce.declareSequence('H', {
      base: { 0: 0 },
      recurrence: 'H_{n-1} + \\operatorname{bump}(n)',
    });
  }
  function readLowerTerms(ce: ComputeEngine): void {
    for (let n = 90; n <= 450; n += 90)
      expect(ce.parse(`H_{${n}}`).evaluate().json).toBe(n);
  }

  test('the memo of a function follows what a sequence reads', () => {
    // `g(2)` reads B_2, and the recurrence of B reads x. Before, the memo
    // of the applications of `g` did not record x, and `g(2)` stayed 2
    // when B_2 was 4. The same with a sequence A that reads B.
    const ce = new ComputeEngine();
    ce.declareSequence('B', { base: { 0: 0 }, recurrence: 'B_{n-1} + x' });
    ce.declareSequence('A', { base: { 0: 0 }, recurrence: 'B_n' });
    ce.assign('x', 1);
    ce.parse('g := k \\mapsto B_k').evaluate();
    ce.parse('h := k \\mapsto A_k').evaluate();
    expect(ce.parse('g(2)').evaluate().json).toBe(2);
    expect(ce.parse('h(2)').evaluate().json).toBe(2);
    ce.assign('x', 2);
    expect(ce.parse('B_{2}').evaluate().json).toBe(4);
    expect(ce.parse('g(2)').evaluate().json).toBe(4);
    expect(ce.parse('h(2)').evaluate().json).toBe(4);
  });

  test('a collection and a symbol value that read a sequence', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('B', { base: { 0: 0 }, recurrence: 'B_{n-1} + x' });
    ce.assign('x', 1);
    const map = ce.function('Map', [
      ce.parse('k \\mapsto B_k'),
      ce.function('Range', [ce.number(1), ce.number(3)]),
    ]);
    ce.declare('s', { value: ce.box(['Subscript', 'B', 2], { form: 'raw' }) });
    const each = (e: Expression) => [...e.each()].map((x) => x.json);
    expect(each(map)).toEqual([1, 2, 3]);
    expect(ce.parse('s').evaluate().json).toBe(2);
    ce.assign('x', 2);
    expect(each(map)).toEqual([2, 4, 6]);
    expect(ce.parse('s').evaluate().json).toBe(4);
  });

  test('the memo of a function does not keep a stopped term', () => {
    const ce = new ComputeEngine();
    declareDeepSequence(ce);
    ce.parse('g := k \\mapsto H_k').evaluate();
    expect(ce.parse('g(500)').evaluate().operator).toBe('Subscript');
    readLowerTerms(ce);
    expect(ce.parse('g(500)').evaluate().json).toBe(500);
  });

  test('the element memo does not keep a stopped term', () => {
    // The walk of the elements read H_500, and the read was stopped.
    // Before, the element memo kept the walk, and the elements stayed
    // `H_500` after the reads of the lower indices.
    const ce = new ComputeEngine();
    declareDeepSequence(ce);
    ce.parse('g := k \\mapsto H_k').evaluate();
    const map = ce.function('Map', [
      ce.symbol('g'),
      ce.function('List', [ce.number(3), ce.number(500)]),
    ]);
    const tabulate = ce.box([
      'Tabulate',
      ['Function', ['Subscript', 'H', ['Add', 'k', 497]], 'k'],
      3,
    ]);
    const each = (e: Expression) => [...e.each()].map((x) => x.json);
    expect(each(map)).toEqual([3, ['Subscript', 'H', 500]]);
    expect(map.at(2)?.json).toEqual(['Subscript', 'H', 500]);
    expect(each(tabulate)).toEqual([
      ['Subscript', 'H', 498],
      ['Subscript', 'H', 499],
      ['Subscript', 'H', 500],
    ]);
    readLowerTerms(ce);
    expect(each(map)).toEqual([3, 500]);
    expect(map.at(2)?.json).toBe(500);
    expect(each(tabulate)).toEqual([498, 499, 500]);
  });

  test('the memo of a stored value does not keep a stopped read', () => {
    // The value of `v` is the term H_500, whose first read is stopped. The
    // memo of the stored value must not keep the declined term: after the
    // reads of the lower indices, `v` gives the term.
    const ce = new ComputeEngine();
    declareDeepSequence(ce);
    ce.assign('v', ce.parse('H_{500}'));
    expect(ce.symbol('v').evaluate().json).toEqual(['Subscript', 'H', 500]);
    readLowerTerms(ce);
    expect(ce.symbol('v').evaluate().json).toBe(500);
  });
});

describe('a fused Map does not dispose the definitions of the scope of its function', () => {
  test('the global definition read by the function stays live', () => {
    // The fused route of `Map` evaluated each element in a frame. It pushed
    // the parent scope of the function, the global scope here, and popping
    // the frame disposed every definition of that scope.
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    ce.assume(ce.parse('q > 0'));
    const map = ce
      .box(['Map', ['Function', ['Add', 'k', 'q'], 'k'], ['Range', 1, 300]])
      .evaluate();
    expect(ce.box(['At', map, 2]).evaluate().toString()).toBe('q + 2');
    const def = ce.lookupDefinition('q') as any;
    expect(def?.value?.disposed ?? def?.disposed).toBe(false);
    expect(ce.symbol('q').isPositive).toBe(true);
  });
});
