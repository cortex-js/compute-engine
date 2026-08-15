import { ComputeEngine } from '../../src/compute-engine';

/**
 * A **collection-TYPED but valueless** operand: a symbol declared
 * `list<number>` / `list<boolean>` that has not been assigned yet, or an
 * application whose head returns a collection.
 *
 * `isCollection` answers a CAPABILITY question — "can I enumerate this NOW" —
 * and is `false` for such an operand, because there is nothing to walk. An
 * operator that used `isCollection` to ask the different question "is this
 * operand collection-SHAPED" therefore took its SCALAR path for an operand
 * that is not a scalar, and committed an answer the SAME expression
 * contradicts once the symbol is assigned.
 *
 * That last clause is what makes these wrong rather than merely undecided, so
 * every case below is written as a PAIR: the valueless expression must stay
 * symbolic, and the identical expression with the symbol assigned must give
 * the real answer. A fix that made the operator inert forever would pass the
 * first half of each pair and fail the second.
 *
 * Audited 2026-08-15 across all 95 `.isCollection` sites in
 * `src/compute-engine`; seven families were affected. `Subset` was fixed by
 * the `subsetOf` operand-convention sweep and is pinned separately; the six
 * below are pinned here.
 */
describe('a collection-TYPED but valueless operand', () => {
  /** A fresh engine with `L` declared `list<number>` and NOT assigned. */
  function withL(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    return ce;
  }

  /** A fresh engine with `L` declared `list<number>` and assigned `value`. */
  function withAssignedL(...value: number[]): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.assign('L', ce.box(['List', ...value]));
    return ce;
  }

  describe('Sum / Product (four guards: the canonical and evaluate sites in library/arithmetic.ts, plus canonicalBigop and bigopGenerator in library/utils.ts)', () => {
    // The fall-through in `bigopGenerator` accumulated the whole collection as
    // ONE term, so `Sum(L)` folded to `0 + L` = `L`.
    it('leaves Sum(L) symbolic rather than answering L', () => {
      const ce = withL();
      const result = ce.box(['Sum', 'L']).evaluate();
      expect(result.operator).toBe('Sum');
      expect(result.isSame(ce.symbol('L'))).toBe(false);
    });

    it('leaves Product(L) symbolic rather than answering L', () => {
      const ce = withL();
      const result = ce.box(['Product', 'L']).evaluate();
      expect(result.operator).toBe('Product');
      expect(result.isSame(ce.symbol('L'))).toBe(false);
    });

    // The other half of the pair, and the reason the fix DECLINES instead of
    // widening the capability tests: widening would send the valueless body
    // into the reducer, which walks zero elements and answers `Sum(L)` → 0 —
    // a worse wrong answer than `L`, because it is indistinguishable from a
    // correct sum over an empty collection.
    it('still sums and multiplies once L is assigned', () => {
      const ce = withAssignedL(1, 2, 3);
      expect(ce.box(['Sum', 'L']).evaluate().re).toBe(6);
      expect(ce.box(['Product', 'L']).evaluate().re).toBe(6);
    });

    it('never answers the empty-collection identity for a valueless L', () => {
      const ce = withL();
      expect(ce.box(['Sum', 'L']).evaluate().re).not.toBe(0);
      expect(ce.box(['Product', 'L']).evaluate().re).not.toBe(1);
    });
  });

  describe('SetMinus (three copies of one rule in library/sets.ts: the eager fold, the Kleene form, and the query decomposition)', () => {
    // The worst shape in the audit: the answer INVERTED on assignment, in a
    // subsystem where a wrong `True` feeds assumption discharge.
    it('does not answer a membership query it cannot decide', () => {
      const ce = withL();
      const result = ce
        .box(['Element', 1, ['SetMinus', ['Set', 1, 2], 'L']])
        .evaluate();
      expect(result.symbol).not.toBe('True');
      expect(result.symbol).not.toBe('False');
      // Pin the SHAPE too, not just the absence of the two old-bug values:
      // `.symbol` is `undefined` for any non-symbol expression, so the two
      // assertions above would also pass for an error expression, `Nothing`,
      // or a malformed result. What this row actually claims is that the
      // membership query stayed HELD.
      expect(result.operator).toBe('Element');
    });

    it('answers False once L is assigned, the answer it used to invert', () => {
      const ce = withAssignedL(1);
      const result = ce
        .box(['Element', 1, ['SetMinus', ['Set', 1, 2], 'L']])
        .evaluate();
      expect(result.symbol).toBe('False');
    });
  });

  describe('Union (library/sets.ts)', () => {
    // Promoting the valueless `L` to the singleton `Set(L)` collapsed the
    // whole collection into a single literal ELEMENT.
    it('does not collapse L into a single element of the union', () => {
      const ce = withL();
      const result = ce.box(['Union', 'L', ['Set', 1]]).evaluate();
      expect(result.operator).toBe('Union');
    });

    it('unions L element-wise once assigned', () => {
      const ce = withAssignedL(5);
      const result = ce.box(['Union', 'L', ['Set', 1]]).evaluate();
      expect(result.operator).toBe('Set');
      expect([...result.ops!].map((x) => x.re).sort()).toEqual([1, 5]);
    });
  });

  describe('the missing-value behavior gate (boxed-expression/boxed-function.ts, steps 4a and 3a)', () => {
    // The gate's "no collection operand" precondition was read as the
    // `isCollection` CAPABILITY, so it fired for an operand destined to
    // broadcast and committed a SCALAR NaN.
    it('does not commit a scalar NaN for Add(Missing, L)', () => {
      const ce = withL();
      expect(ce.box(['Add', 'Missing', 'L']).evaluate().isNaN).not.toBe(true);
    });

    it('broadcasts the absence per cell once L is assigned', () => {
      const ce = withAssignedL(1, 2);
      const result = ce.box(['Add', 'Missing', 'L']).evaluate();
      expect(result.isCollection).toBe(true);
      expect([...result.each()].length).toBe(2);
    });

    // Parity with the sync gate: the two guards decide the same question on
    // two routes and must gain the disjunct together.
    it('agrees on the async route', async () => {
      const ce = withL();
      const result = await ce.box(['Add', 'Missing', 'L']).evaluateAsync();
      expect(result.isNaN).not.toBe(true);
    });
  });

  describe('the statistics aggregates (library/statistics.ts)', () => {
    // `Quartiles`/`InterquartileRange` already stayed inert; the other nine
    // reached the numeric kernels, which read a valueless symbol as NaN.
    const AGGREGATES = [
      'Mean',
      'Median',
      'Variance',
      'PopulationVariance',
      'StandardDeviation',
      'PopulationStandardDeviation',
      'Kurtosis',
      'Skewness',
      'Mode',
      'Quartiles',
      'InterquartileRange',
    ];

    it.each(AGGREGATES)(
      '%s(L) stays inert rather than folding to NaN',
      (op) => {
        const ce = withL();
        const result = ce.box([op, 'L']).evaluate();
        expect(result.isNaN).not.toBe(true);
        expect(result.operator).toBe(op);
      }
    );

    // A valueless SCALAR symbol is the same defect: `Mean(y)` folded to NaN
    // via `.re`. This is the rule `Quartiles` has always applied.
    it.each(AGGREGATES)('%s(y) stays inert for a free scalar symbol', (op) => {
      const ce = new ComputeEngine();
      expect(ce.box([op, 'y']).evaluate().isNaN).not.toBe(true);
    });

    it('still computes once L is assigned', () => {
      const ce = withAssignedL(1, 2, 3);
      expect(ce.box(['Mean', 'L']).evaluate().re).toBe(2);
      expect(ce.box(['Median', 'L']).evaluate().re).toBe(2);
    });

    // A NaN LITERAL is a number and must still flow through, or this guard
    // would have broken absent-datum semantics (§3.C) instead of the
    // valueless-operand case it targets.
    it('still folds an absent datum to NaN', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['Mean', ['List', 1, 'Missing', 3]]).evaluate().isNaN).toBe(
        true
      );
    });
  });

  describe('Which / If (library/control-structures.ts)', () => {
    // This one hard-THREW out of `evaluate()`, where the compiled path
    // already held the same condition.
    it('holds Which rather than throwing on a list<boolean> condition', () => {
      const ce = new ComputeEngine();
      ce.declare('B', 'list<boolean>');
      expect(() =>
        ce.box(['Which', 'B', 1, 'True', 2]).evaluate()
      ).not.toThrow();
      expect(ce.box(['Which', 'B', 1, 'True', 2]).evaluate().operator).toBe(
        'Which'
      );
    });

    it('selects element-wise once B is assigned', () => {
      const ce = new ComputeEngine();
      ce.declare('B', 'list<boolean>');
      ce.assign('B', ce.box(['List', 'True', 'False']));
      const result = ce.box(['Which', 'B', 1, 'True', 2]).evaluate();
      expect(result.isCollection).toBe(true);
    });

    // The throw is RESERVED for a condition that can never be boolean, where
    // the spell-check hint is the useful outcome. Widening the hold must not
    // have swallowed that.
    it('still throws for a condition that is not booleanish at all', () => {
      const ce = new ComputeEngine();
      ce.declare('N', 'list<number>');
      expect(() => ce.box(['Which', 'N', 1, 'True', 2]).evaluate()).toThrow();
    });
  });
});
