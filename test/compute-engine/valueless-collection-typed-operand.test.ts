import { ComputeEngine } from '../../src/compute-engine';
import { isUnresolvedCollectionOperand } from '../../src/compute-engine/collection-utils';

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

  describe('the element-wise broadcast funnels (collection-utils.ts, arithmetic-add.ts, arithmetic-mul-div.ts, boxed-function.ts)', () => {
    // Tycho item 221. A broadcast lifts every NON-participant operand into
    // each cell, and participation is the `isCollection` capability — so a
    // valueless `list<number>` operand was spliced whole, as if it were a
    // scalar. The stored form then materialized an OUTER PRODUCT once the
    // symbol was assigned, where a fresh evaluation of the same expression
    // zipped. Both halves are pinned below: symbolic while valueless, the zip
    // once assigned.

    /** An unknown-length view: `Map(_ ↦ _/n, Range(0, n))` with `n` valueless. */
    function withView(): ComputeEngine {
      const ce = new ComputeEngine();
      ce.declare('n', 'number');
      ce.declare('s', 'list<number>');
      ce.assign(
        'A',
        ce
          .box([
            'Map',
            ['Function', ['Divide', '_', 'n'], '_'],
            ['Range', 0, 'n'],
          ])
          .evaluate()
      );
      return ce;
    }

    it('keeps Multiply(A, s) symbolic for an unknown-length view', () => {
      const ce = withView();
      const stored = ce.box(['Multiply', 'A', 's']).evaluate();
      // The old form was `Map(_ ↦ _·s, A)` — `s` captured inside the mapping
      // function's body, as one factor per element. It must stay an operand of
      // the product instead.
      expect(stored.operator).toBe('Multiply');
      expect(stored.ops!.some((op) => op.symbol === 's')).toBe(true);
    });

    it('re-evaluates the stored product as a ZIP once s and n are assigned', () => {
      const ce = withView();
      const stored = ce.box(['Multiply', 'A', 's']).evaluate();
      ce.assign('s', ['List', 10, 20, 30]);
      ce.assign('n', 2);
      // `A` is `[0, 1/2, 1]` once `n` resolves, so the zip is `[0, 10, 30]`;
      // the outer product this used to store materialized as
      // `[[0,0,0],[5,10,15],[10,20,30]]`.
      expect(ce.box(['ListFrom', stored.json]).evaluate().toString()).toBe(
        '[0,10,30]'
      );
      expect(ce.box(stored.json).evaluate().toString()).toBe('[0,10,30]');
      // …and agrees with evaluating the product from scratch.
      expect(ce.box(['Multiply', 'A', 's']).evaluate().toString()).toBe(
        '[0,10,30]'
      );
    });

    it('types the inert product as a collection of NUMBERS, not of lists', () => {
      const ce = withView();
      const stored = ce.box(['Multiply', 'A', 's']).evaluate();
      // The zip's element type wrapped in the collection shape. The captured
      // form typed `indexed_collection<list<number>>` — one rank too deep.
      expect(stored.type.matches('collection<number>')).toBe(true);
      expect(stored.type.matches('collection<list<number>>')).toBe(false);
    });

    it('keeps a KNOWN-length product symbolic, then zips it', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      const stored = ce.box(['Multiply', ['List', 1, 2, 3], 's']).evaluate();
      expect(stored.operator).toBe('Multiply');
      expect(stored.type.matches('collection<number>')).toBe(true);
      ce.assign('s', ['List', 10, 20, 30]);
      expect(ce.box(stored.json).evaluate().toString()).toBe('[10,40,90]');
    });

    it('keeps a KNOWN-length sum symbolic, then zips it', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      const stored = ce.box(['Add', ['List', 1, 2, 3], 's']).evaluate();
      expect(stored.operator).toBe('Add');
      expect(stored.type.matches('collection<number>')).toBe(true);
      ce.assign('s', ['List', 10, 20, 30]);
      expect(ce.box(stored.json).evaluate().toString()).toBe('[11,22,33]');
    });

    // The witness shape reported by the consumer: the unresolved operand is an
    // APPLICATION (`PointX(P)`, a `list<number>`), not a bare symbol.
    it('keeps Multiply(A, PointX(P)) symbolic for a valueless point list', () => {
      const ce = new ComputeEngine();
      ce.declare('n', 'number');
      ce.declare('P', 'list<tuple<number, number>>');
      ce.assign(
        'A',
        ce
          .box([
            'Map',
            ['Function', ['Divide', '_', 'n'], '_'],
            ['Range', 0, 'n'],
          ])
          .evaluate()
      );
      const stored = ce.box(['Multiply', 'A', ['PointX', 'P']]).evaluate();
      expect(stored.operator).toBe('Multiply');
      expect(stored.type.matches('collection<number>')).toBe(true);
    });

    it('zips Multiply(A, PointX(P)) once P and n are assigned', () => {
      const ce = new ComputeEngine();
      ce.declare('n', 'number');
      ce.assign('n', 2);
      ce.assign('P', [
        'List',
        ['Tuple', 1, 10],
        ['Tuple', 2, 20],
        ['Tuple', 3, 30],
      ]);
      ce.assign(
        'A',
        ce
          .box([
            'Map',
            ['Function', ['Divide', '_', 'n'], '_'],
            ['Range', 0, 'n'],
          ])
          .evaluate()
      );
      // `A` is `[0, 1/2, 1]`, `PointX(P)` is `[1, 2, 3]`.
      expect(
        ce
          .box(['Multiply', 'A', ['PointX', 'P']])
          .evaluate()
          .toString()
      ).toBe('[0,1,3]');
    });

    // Route parity: the veto reads the operands, not the way they were built.
    it('agrees on the box, parse and .N() routes', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      expect(ce.parse('[1,2,3] \\cdot s').evaluate().operator).toBe('Multiply');
      expect(ce.box(['Multiply', ['List', 1, 2, 3], 's']).N().operator).toBe(
        'Multiply'
      );
      ce.assign('s', ['List', 0.5, 0.5, 0.5]);
      expect(ce.parse('[1,2,3] \\cdot s').evaluate().toString()).toBe(
        '[0.5,1,1.5]'
      );
      expect(
        ce
          .box(['Multiply', ['List', 1, 2, 3], 's'])
          .N()
          .toString()
      ).toBe('[0.5,1,1.5]');
    });

    // Parity with the sync gates: the pre- and post-evaluation broadcast steps
    // exist in a sync and an async copy and must decide alike.
    it('agrees on the async route', async () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      const stored = await ce
        .box(['Multiply', ['List', 1, 2, 3], 's'])
        .evaluateAsync();
      expect(stored.operator).toBe('Multiply');
      ce.assign('s', ['List', 10, 20, 30]);
      expect((await ce.box(stored.json).evaluateAsync()).toString()).toBe(
        '[10,40,90]'
      );
    });

    // A lambda parameter bound to a valueless collection symbol is the same
    // splice: inference types the parameter `number` (the body's use narrowed
    // it), so the veto follows the parameter's VALUE.
    it('does not bind a valueless list argument as a per-element scalar', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      ce.assign('g', ce.parse('(a, b) \\mapsto a + b'));
      const stored = ce.box(['g', ['List', 1, 2, 3], 's']).evaluate();
      expect(stored.toString()).not.toBe('[s + 1,s + 2,s + 3]');
      ce.assign('s', ['List', 10, 20, 30]);
      expect(
        ce
          .box(['g', ['List', 1, 2, 3], 's'])
          .evaluate()
          .toString()
      ).toBe('[11,22,33]');
    });

    // A `broadcastable<T>` DECLARATION maps its slot element-wise, so the
    // same capture happens there — at a mappable slot only. Declining hands
    // the application back to the ordinary route, where the body stays
    // symbolic (`setupDeclaredBroadcast`, boxed-function.ts).
    it('declines a declared broadcastable slot holding a valueless list', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      ce.declare(
        'h',
        '(broadcastable<number>, broadcastable<number>) -> number'
      );
      ce.assign('h', ce.parse('(a, b) \\mapsto a + b'));
      const stored = ce.box(['h', ['List', 1, 2, 3], 's']).evaluate();
      expect(stored.toString()).not.toBe('[s + 1,s + 2,s + 3]');
      ce.assign('s', ['List', 10, 20, 30]);
      expect(
        ce
          .box(['h', ['List', 1, 2, 3], 's'])
          .evaluate()
          .toString()
      ).toBe('[11,22,33]');
    });

    // `broadcastComparison` (library/relational-operator.ts) rebuilds the
    // comparison and re-enters `evaluate()`, counting on the pre-evaluation
    // broadcast to zip it. Once that broadcast declines, the re-entry comes
    // straight back — so the comparison helper must apply the same veto, or
    // the two ping-pong until the stack is exhausted.
    it('does not recurse on a comparison against a valueless list', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      expect(() =>
        ce.box(['Less', ['List', 1, 2, 3], 's']).evaluate()
      ).not.toThrow();
      expect(ce.box(['Less', ['List', 1, 2, 3], 's']).evaluate().operator).toBe(
        'Less'
      );
      ce.assign('s', ['List', 10, 20, 30]);
      expect(
        [
          ...ce
            .box(['Less', ['List', 1, 2, 3], 's'])
            .evaluate()
            .each(),
        ].map((x) => x.symbol)
      ).toEqual(['True', 'True', 'True']);
    });

    // `When`'s restriction distributes over a collection value with the
    // condition spliced into each cell. A collection-typed but valueless
    // condition is a MASK the zip cannot read yet, not a scalar guard.
    it('holds a When whose mask is a valueless list of booleans', () => {
      const ce = new ComputeEngine();
      ce.declare('B', 'list<boolean>');
      const stored = ce.box(['When', ['List', 1, 2], 'B']).evaluate();
      expect(stored.operator).toBe('When');
      ce.assign('B', ['List', 'True', 'False']);
      // The captured form was `[1 {B}, 2 {B}]`, which re-evaluated to the
      // nested `[[1,Undefined],[2,Undefined]]`.
      expect(ce.box(stored.json).evaluate().toString()).toBe(
        ce
          .box(['When', ['List', 1, 2], 'B'])
          .evaluate()
          .toString()
      );
      expect(ce.box(stored.json).evaluate().toString()).toBe('[1,"Undefined"]');
    });

    // `PointList` zips its components into points, lifting a scalar component
    // into every point. A collection-typed but valueless component is not a
    // scalar, and it fails closed with the components that cannot be zipped.
    it('holds a PointList with a valueless list component', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      const stored = ce.box(['PointList', ['List', 1, 2], 's']).evaluate();
      expect(stored.operator).toBe('PointList');
      ce.assign('s', ['List', 10, 20]);
      // The captured form was `[(1, s), (2, s)]`, which re-evaluated to
      // `[(1, [10,20]), (2, [10,20])]`.
      expect(ce.box(stored.json).evaluate().toString()).toBe(
        '[(1, 10),(2, 20)]'
      );
    });

    it('still lifts a valueless NUMBER-typed PointList component', () => {
      const ce = new ComputeEngine();
      ce.declare('y', 'number');
      expect(
        ce
          .box(['PointList', ['List', 1, 2], 'y'])
          .evaluate()
          .toString()
      ).toBe('[(1, y),(2, y)]');
    });

    // The CONTROL, and the reason the veto is keyed on the collection TYPE: a
    // valueless SCALAR symbol is a genuine per-cell lift and must keep
    // broadcasting — lazily over an unknown-length source, eagerly over a
    // known-length one.
    it('still broadcasts over a valueless NUMBER-typed symbol', () => {
      const ce = new ComputeEngine();
      ce.declare('n', 'number');
      ce.declare('x', 'number');
      const lazy = ce
        .box([
          'Multiply',
          ['Map', ['Function', ['Divide', '_', 'n'], '_'], ['Range', 0, 'n']],
          'x',
        ])
        .evaluate();
      expect(lazy.operator).toBe('Map');
      expect(lazy.type.matches('indexed_collection<number>')).toBe(true);
      expect(
        ce
          .box(['Multiply', ['List', 1, 2, 3], 'x'])
          .evaluate()
          .toString()
      ).toBe('[x,2x,3x]');
    });

    // Tuples and strings are atomic under broadcast whether or not they have a
    // value, so the veto must not reach them.
    it('still scales a list by a valueless TUPLE-typed symbol', () => {
      const ce = new ComputeEngine();
      ce.declare('t', 'tuple<number, number>');
      expect(
        ce
          .box(['Multiply', ['List', 1, 2, 3], 't'])
          .evaluate()
          .toString()
      ).toBe('[1t,2t,3t]');
    });

    // An ordinary symbolic product has no broadcast to decline: with no
    // collection participant, `2s` must keep folding as it always has.
    it('still folds a product that has no broadcast participant', () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'list<number>');
      expect(ce.box(['Multiply', 2, 's']).evaluate().toString()).toBe('2s');
      expect(ce.box(['Multiply', 's', 's']).evaluate().toString()).toBe('s^2');
    });
  });
  describe('the routes the broadcast veto did not reach', () => {
    // Five ways a valueless collection-typed operand was still captured after
    // the veto above went in. Each is a PAIR, for the reason the file header
    // gives: the expression must stay symbolic while the operand has no value,
    // and the SAME expression, re-evaluated once the operand is assigned, must
    // agree with evaluating it from scratch.

    describe('a tuple factor (mulTuples, arithmetic-mul-div.ts)', () => {
      // `mulTuples` splices every non-tuple factor into each COMPONENT of the
      // tuple — the per-cell capture one rank up. It was unguarded because the
      // veto above requires a broadcast PARTICIPANT and a tuple is not one (it
      // is atomic under broadcast), so a tuple-and-symbol product had no
      // participant at all.
      it('keeps Multiply(Tuple(1,2), s) symbolic, then transposes it', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        const stored = ce.box(['Multiply', ['Tuple', 1, 2], 's']).evaluate();
        // The captured form was the tuple of products `(s, 2s)`.
        expect(stored.operator).toBe('Multiply');
        ce.assign('s', ['List', 10, 20]);
        // `(s, 2s)` re-evaluated to the tuple of lists `([10,20], [20,40])`.
        expect(ce.box(stored.json).evaluate().toString()).toBe(
          '[(10, 20),(20, 40)]'
        );
        expect(
          ce
            .box(['Multiply', ['Tuple', 1, 2], 's'])
            .evaluate()
            .toString()
        ).toBe('[(10, 20),(20, 40)]');
      });

      it('applies the same guard on the .N() re-dispatch', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        const stored = ce.box(['Multiply', ['Tuple', 1, 2], 's']).N();
        expect(stored.operator).toBe('Multiply');
        ce.assign('s', ['List', 10, 20]);
        expect(ce.box(stored.json).N().toString()).toBe('[(10, 20),(20, 40)]');
      });

      it('holds a tuple · list · valueless-list product', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        ce.declare('a', 'number');
        ce.declare('b', 'number');
        const product = [
          'Multiply',
          ['Tuple', 'a', 'b'],
          ['List', 1, 2, 3],
          's',
        ];
        const stored = ce.box(product).evaluate();
        // The captured form was `(a·s·[1,2,3], b·s·[1,2,3])`.
        expect(stored.operator).toBe('Multiply');
        ce.assign('s', ['List', 10, 20, 30]);
        expect(ce.box(stored.json).evaluate().toString()).toBe(
          '[(10a, 10b),(40a, 40b),(90a, 90b)]'
        );
        expect(ce.box(product).evaluate().toString()).toBe(
          '[(10a, 10b),(40a, 40b),(90a, 90b)]'
        );
      });

      // `addTuples` needs no such guard: it fires only when EVERY operand is a
      // tuple, so a valueless list operand can never reach it. Pinned as the
      // pair anyway — whatever `Add(Tuple(1,2), s)` answers, the stored form
      // and a fresh evaluation must answer the same thing.
      it('leaves the Add tuple branch alone', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        const stored = ce.box(['Add', ['Tuple', 1, 2], 's']).evaluate();
        ce.assign('s', ['List', 10, 20]);
        expect(ce.box(stored.json).evaluate().toString()).toBe(
          ce
            .box(['Add', ['Tuple', 1, 2], 's'])
            .evaluate()
            .toString()
        );
      });

      // The CONTROL: a valueless SCALAR co-factor is a genuine per-component
      // lift and must keep scaling the tuple.
      it('still scales a tuple by a valueless number', () => {
        const ce = new ComputeEngine();
        ce.declare('y', 'number');
        expect(
          ce
            .box(['Multiply', ['Tuple', 1, 2], 'y'])
            .evaluate()
            .toString()
        ).toBe('(y, 2y)');
      });
    });

    describe('a lambda whose body is not itself element-wise (boxed-function.ts)', () => {
      // Declining the broadcast is not enough on its own: execution continued
      // into the ordinary application and INLINED the literal. With an `Add`
      // body the arithmetic veto masked that; with a `Tuple` body nothing did.
      it('holds g([1,2], s) for a tuple-bodied g, then zips it', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        ce.assign('g', ce.parse('(a, b) \\mapsto (a, b)'));
        const stored = ce.box(['g', ['List', 1, 2], 's']).evaluate();
        // The inlined form was `([1,2], s)`.
        expect(stored.operator).toBe('g');
        ce.assign('s', ['List', 10, 20]);
        // `([1,2], s)` re-evaluated to the tuple of lists `([1,2], [10,20])`.
        expect(ce.box(stored.json).evaluate().toString()).toBe(
          '[(1, 10),(2, 20)]'
        );
        expect(
          ce
            .box(['g', ['List', 1, 2], 's'])
            .evaluate()
            .toString()
        ).toBe('[(1, 10),(2, 20)]');
      });

      it('agrees on the async route', async () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        ce.assign('g', ce.parse('(a, b) \\mapsto (a, b)'));
        const stored = await ce.box(['g', ['List', 1, 2], 's']).evaluateAsync();
        expect(stored.operator).toBe('g');
        ce.assign('s', ['List', 10, 20]);
        expect((await ce.box(stored.json).evaluateAsync()).toString()).toBe(
          '[(1, 10),(2, 20)]'
        );
      });

      // The same hold at the DECLARED-`broadcastable<T>` route, which returns
      // its terminal results through `setupDeclaredBroadcast`.
      it('holds a declared broadcastable application with a tuple body', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        ce.declare(
          'h',
          '(broadcastable<number>, broadcastable<number>) -> tuple<number, number>'
        );
        ce.assign('h', ce.parse('(a, b) \\mapsto (a, b)'));
        const stored = ce.box(['h', ['List', 1, 2], 's']).evaluate();
        expect(stored.operator).toBe('h');
        ce.assign('s', ['List', 10, 20]);
        expect(ce.box(stored.json).evaluate().toString()).toBe(
          '[(1, 10),(2, 20)]'
        );
      });
    });

    describe('an operand whose type only ADMITS a collection (collection-utils.ts)', () => {
      // `matches('collection<any>')` asks whether the type DEFINITELY is a
      // collection, so a union with a scalar branch defeats it and the operand
      // was spliced.
      it('holds Add([1,2], u) for u: number | list<number>, then zips it', () => {
        const ce = new ComputeEngine();
        ce.declare('u', 'number | list<number>');
        const stored = ce.box(['Add', ['List', 1, 2], 'u']).evaluate();
        // The captured form was `[u + 1, u + 2]`, typed `list<list<number>>`.
        expect(stored.operator).toBe('Add');
        ce.assign('u', ['List', 10, 20]);
        // It re-evaluated to the outer sum `[[11,21],[12,22]]`.
        expect(ce.box(stored.json).evaluate().toString()).toBe('[11,22]');
        expect(
          ce
            .box(['Add', ['List', 1, 2], 'u'])
            .evaluate()
            .toString()
        ).toBe('[11,22]');
      });

      // The other resolution of the same union: holding is right either way,
      // because the held sum lifts the scalar once the scalar branch is the
      // one that is assigned.
      it('lifts the same sum when the union resolves to a scalar', () => {
        const ce = new ComputeEngine();
        ce.declare('u', 'number | list<number>');
        const stored = ce.box(['Add', ['List', 1, 2], 'u']).evaluate();
        ce.assign('u', 5);
        expect(ce.box(stored.json).evaluate().toString()).toBe('[6,7]');
      });

      // `broadcastable<T>` is the other spelling of "scalar or collection,
      // undecided", and it was captured the same way.
      it('holds Add([1,2], b) for b: broadcastable<number>, then zips it', () => {
        const ce = new ComputeEngine();
        ce.declare('b', 'broadcastable<number>');
        const stored = ce.box(['Add', ['List', 1, 2], 'b']).evaluate();
        // The captured form was `[b + 1, b + 2]`.
        expect(stored.operator).toBe('Add');
        ce.assign('b', ['List', 10, 20]);
        expect(ce.box(stored.json).evaluate().toString()).toBe('[11,22]');
      });

      it('lifts the same sum when the broadcastable resolves to a scalar', () => {
        const ce = new ComputeEngine();
        ce.declare('b', 'broadcastable<number>');
        const stored = ce.box(['Add', ['List', 1, 2], 'b']).evaluate();
        ce.assign('b', 5);
        expect(ce.box(stored.json).evaluate().toString()).toBe('[6,7]');
      });

      // A `broadcastable<T>` that arises MID-EXPRESSION rather than from a
      // declaration is untouched: canonical flattening dissolves it into the
      // enclosing sum, whose own operand types are the top `unknown` the veto
      // deliberately excludes.
      it('still broadcasts over a derived broadcastable operand', () => {
        const ce = new ComputeEngine();
        ce.declare('x', 'number');
        expect(
          ce
            .box(['Add', ['List', 1, 2], ['Add', 2, ['h', 'x']]])
            .evaluate()
            .toString()
        ).toBe('[h(x) + 3,h(x) + 4]');
      });

      // The CONTROLS: a union with no collection alternative, and unions whose
      // only non-scalar alternative is atomic under broadcast, are ordinary
      // per-cell lifts.
      it('still broadcasts over unions with no mappable alternative', () => {
        const ce = new ComputeEngine();
        ce.declare('w', 'number | boolean');
        ce.declare('ts', 'number | tuple<number, number>');
        expect(
          ce
            .box(['Add', ['List', 1, 2], 'w'])
            .evaluate()
            .toString()
        ).toBe('[w + 1,w + 2]');
        expect(
          ce.box(['Multiply', ['List', 1, 2], 'ts']).evaluate().operator
        ).toBe('List');
      });
    });

    describe('a tuple-typed operand with no tuple NODE (collection-utils.ts)', () => {
      // `isTuple` reads the type STRUCTURE, so it sees neither the bare `tuple`
      // primitive nor a transparent alias for a tuple — and a bare-`tuple`
      // symbol IS a collection, so the veto claimed it and stopped the
      // component-wise scaling that worked before the veto existed.
      it('still scales a list by a valueless bare-tuple symbol', () => {
        const ce = new ComputeEngine();
        ce.declare('r', 'tuple');
        expect(
          ce
            .box(['Multiply', ['List', 1, 2, 3], 'r'])
            .evaluate()
            .toString()
        ).toBe('[r,2r,3r]');
      });

      // Asserted on the PREDICATE rather than on an expression: both
      // `Multiply` and `Add` currently refuse an alias-typed operand with
      // `incompatible-type "number" vs "pt"` — an admission defect that
      // predates the veto and is being fixed separately — so no arithmetic
      // route can witness the exemption.
      it('exempts a transparent type alias for a tuple', () => {
        const ce = new ComputeEngine();
        ce.declareType('pt', 'tuple<number, number>');
        ce.declare('p', 'pt');
        expect(isUnresolvedCollectionOperand(ce.symbol('p'))).toBe(false);
        // …while the shape the veto exists for is still recognized.
        ce.declare('s', 'list<number>');
        expect(isUnresolvedCollectionOperand(ce.symbol('s'))).toBe(true);
      });
    });

    describe('a length disagreement the veto used to hide', () => {
      // The veto ran before any length check, so an operand list that could
      // never zip — 2 elements against 3 — went inert instead of erroring. No
      // value of the unresolved operand reconciles those lengths.
      it('errors on Add / Multiply / Less with a definite mismatch', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        const ops = [['List', 1, 2], ['List', 3, 4, 5], 's'];
        for (const operator of ['Add', 'Multiply', 'Less']) {
          const result = ce.box([operator, ...ops]).evaluate();
          expect(result.operator).toBe('Error');
          expect(result.toString()).toContain('incompatible-dimensions');
        }
      });

      it('errors at the lambda and declared-broadcast gates too', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        ce.assign('g', ce.parse('(a, b, c) \\mapsto (a, b, c)'));
        ce.declare(
          'h',
          '(broadcastable<number>, broadcastable<number>, broadcastable<number>) -> tuple<number, number, number>'
        );
        ce.assign('h', ce.parse('(a, b, c) \\mapsto (a, b, c)'));
        for (const operator of ['g', 'h']) {
          const result = ce
            .box([operator, ['List', 1, 2], ['List', 3, 4, 5], 's'])
            .evaluate();
          expect(result.operator).toBe('Error');
          expect(result.toString()).toContain('incompatible-dimensions');
        }
      });

      // The CONTROL: a pairing constructor zips to the shortest component by
      // ruling (`strictLengths: false`), so unequal lengths are not an error
      // there and the veto's hold is all that changes.
      it('leaves PointList pairing alone', () => {
        const ce = new ComputeEngine();
        ce.declare('s', 'list<number>');
        expect(
          ce
            .box(['PointList', ['List', 1, 2], ['List', 3, 4, 5]])
            .evaluate()
            .toString()
        ).toBe('[(1, 3),(2, 4)]');
        expect(
          ce
            .box(['PointList', ['List', 1, 2], ['List', 3, 4, 5], 's'])
            .evaluate().operator
        ).toBe('PointList');
      });
    });
  });
});

/**
 * The ELEMENT type of a broadcast that the veto above holds. A union of a
 * scalar branch and a list branch broadcasts into the SAME cells whichever
 * branch the operand turns out to hold — the scalar branch folds into every
 * cell, the list branch zips with it — so the cells stay scalar. Widening the
 * operand's raw union into the result instead put its LIST branch inside the
 * cells (`Add([1,2], u)` typed `list<list<number> | number^2>`), a type
 * neither resolution of the union ever produces.
 */
describe('the element type of a held broadcast over a union-typed operand', () => {
  it('matches the list<number> control for Add and Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'list<number>'); // the control: definitely a list
    ce.declare('u', 'number | list<number>'); // scalar-or-list
    for (const operator of ['Add', 'Multiply']) {
      const control = ce.box([operator, ['List', 1, 2], 's']).evaluate();
      const union = ce.box([operator, ['List', 1, 2], 'u']).evaluate();
      expect(control.type.toString()).toBe('list<number>');
      expect(union.type.toString()).toBe(control.type.toString());
    }
  });

  // Both resolutions of the union have scalar cells, which is what makes the
  // held form's element type sound rather than merely conservative.
  it('is borne out by both halves of the union', () => {
    const withU = (value: number | (number | string)[]) => {
      const ce = new ComputeEngine();
      ce.declare('u', 'number | list<number>');
      ce.assign('u', value as any);
      return ce.box(['Add', ['List', 1, 2], 'u']).evaluate();
    };
    const asList = withU(['List', 10, 20]);
    expect(asList.toString()).toBe('[11,22]');
    expect(asList.type.matches('list<number>')).toBe(true);
    const asScalar = withU(5);
    expect(asScalar.toString()).toBe('[6,7]');
    expect(asScalar.type.matches('list<number>')).toBe(true);
  });

  // `broadcastable<T>` is the other spelling of "scalar or collection,
  // undecided". It is a co-operand that folds INTO the cells, so it
  // contributes its element `T` there; the wrapper itself nested inside the
  // list (`list<broadcastable<number>^2>`) is a type no value has. The length
  // stays 2 because a broadcastable operand of a different length is an
  // `incompatible-dimensions` error, not a wider result.
  it('unwraps a broadcastable operand instead of nesting it in the cells', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'broadcastable<number>');
    for (const operator of ['Add', 'Multiply']) {
      const t = ce.box([operator, ['List', 1, 2], 'b']).evaluate().type;
      expect(t.toString()).toBe('vector<2>'); // = list<number^2>
      expect(t.matches('list<number>')).toBe(true);
    }
  });

  // The union genuinely widens the cells here: the scalar branch `integer` and
  // the list branch's `real` elements both land in the same cells, so the
  // element type is their widening — `[1,2] * m` is `[1.5, 2.25]` for
  // `m := [0.5, 0.25]`.
  it('widens the scalar branch into the element type', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer | list<real>');
    for (const operator of ['Add', 'Multiply'])
      expect(
        ce
          .box([operator, ['List', 1, 2], 'm'])
          .evaluate()
          .type.toString()
      ).toBe('list<real>');
  });
});

/**
 * A LONE union-typed operand — a valueless symbol declared
 * `number | list<number>` with no operand beside it that is definitely a
 * collection — is not a collection. Typing `2u` as the definite
 * `list<finite_number>` (what the broadcast wrapper did, by reading "the union
 * HAS a collection branch" as "the operand IS a collection") states something
 * the very same expression contradicts once the symbol is assigned: `u := 5`
 * makes `2u` evaluate to the scalar `10`.
 *
 * The rule is to carry the declared union through instead. The result is
 * the scalar per-element result unioned with that result wrapped back in each
 * of the operand's collection branches, keeping each branch's own collection
 * KIND. `broadcastable<T>` — the spelling for an operand whose collection-ness
 * is not statically visible at all — is deliberately NOT recruited for a
 * declared union.
 *
 * Written as PAIRS like the rest of this file: the symbolic type while the
 * symbol is valueless, and the value the identical expression produces under
 * each half of the union.
 */
describe('a LONE union-typed operand keeps the union in the result type', () => {
  const engineWithU = () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<number>');
    return ce;
  };

  it('carries the union through every lifted operator', () => {
    const ce = engineWithU();
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'finite_number | list<finite_number>'
    );
    expect(ce.box(['Add', 'u', 2]).type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.box(['Negate', 'u']).type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.box(['Power', 'u', 2]).type.toString()).toBe(
      'finite_number | list<finite_number>'
    );
    expect(ce.box(['Sin', 'u']).type.toString()).toBe(
      'finite_number | list<finite_number>'
    );
  });

  // The point of the ruling: a scalar-or-collection union must not answer a
  // confident YES to "is this a collection". Every gate keyed on that match —
  // `isCollectionShaped` (the `And`/`Or` short circuit, the relational chains)
  // and `isValuelessCollectionTyped` — reads the union as undecided again.
  it('does not match collection', () => {
    const ce = engineWithU();
    const t = ce.box(['Multiply', 2, 'u']).type;
    expect(t.matches('collection')).toBe(false);
    expect(t.matches('collection<any>')).toBe(false);
  });

  // The collection branch keeps its own kind, so an operand that may be a
  // non-list `indexed_collection` at runtime is never claimed to be a `list`.
  // A `range` branch cannot carry a rewritten element type (its members are
  // integers by definition), so it widens to `indexed_collection`.
  it('preserves the collection kind of each branch', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'integer | indexed_collection<integer>');
    ce.declare('r', 'integer | range');
    expect(ce.box(['Multiply', 2, 'v']).type.toString()).toBe(
      'finite_number | indexed_collection<finite_number>'
    );
    expect(ce.box(['Negate', 'v']).type.toString()).toBe(
      'indexed_collection<integer> | integer'
    );
    expect(ce.box(['Multiply', 2, 'r']).type.toString()).toBe(
      'finite_number | indexed_collection<finite_number>'
    );
  });

  // The other half of the pair: both branch kinds broadcast element-wise once
  // the symbol holds an indexed collection, and the `range` union stays scalar
  // under its integer branch.
  it('broadcasts once the branch-kind symbols hold a value', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'integer | indexed_collection<integer>');
    ce.declare('r', 'integer | range');
    ce.assign('v', ce.box(['Range', 1, 3]));
    ce.assign('r', ce.box(['Range', 1, 3]));
    expect(ce.box(['Multiply', 2, 'v']).evaluate().toString()).toBe('[2,4,6]');
    expect(ce.box(['Negate', 'v']).evaluate().toString()).toBe('[-1,-2,-3]');
    expect(ce.box(['Multiply', 2, 'r']).evaluate().toString()).toBe('[2,4,6]');

    const scalarCe = new ComputeEngine();
    scalarCe.declare('r', 'integer | range');
    scalarCe.assign('r', 4);
    expect(scalarCe.box(['Multiply', 2, 'r']).evaluate().toString()).toBe('8');
  });

  // Two lone unions: scalar+scalar, list+scalar, scalar+list and list+list all
  // land on a scalar or on a list of scalars, so the four branch combinations
  // collapse back to the same two-member union.
  it('collapses two lone unions to the same shape', () => {
    const ce = engineWithU();
    ce.declare('w', 'number | list<number>');
    expect(ce.box(['Add', 'u', 'w']).type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.box(['Multiply', 'u', 'w']).type.toString()).toBe(
      'finite_number | list<finite_number>'
    );
  });

  // The other half of the pair: the same two expressions once both symbols
  // hold values — two lists zip element-wise, and a scalar branch folds into
  // every cell of the other's list.
  it('evaluates two assigned unions branch by branch', () => {
    const ce = engineWithU();
    ce.declare('w', 'number | list<number>');
    ce.assign('u', ce.box(['List', 1, 2]));
    ce.assign('w', ce.box(['List', 10, 20]));
    expect(ce.box(['Add', 'u', 'w']).evaluate().toString()).toBe('[11,22]');
    expect(ce.box(['Multiply', 'u', 'w']).evaluate().toString()).toBe('[10,40]');

    const mixedCe = engineWithU();
    mixedCe.declare('w', 'number | list<number>');
    mixedCe.assign('u', 3);
    mixedCe.assign('w', mixedCe.box(['List', 10, 20]));
    expect(mixedCe.box(['Add', 'u', 'w']).evaluate().toString()).toBe(
      '[13,23]'
    );
  });

  // The control: with a sibling that IS definitely a collection, every branch
  // of the union lands in that sibling's cells — the scalar branch folds into
  // each cell, the list branch zips element-wise — so the definite `list<E>`
  // stays the honest answer. This is the behavior the block above
  // (`the element type of a held broadcast over a union-typed operand`) pins.
  it('still types a definite collection sibling as a definite list', () => {
    const ce = engineWithU();
    for (const operator of ['Add', 'Multiply'])
      expect(ce.box([operator, ['List', 1, 2], 'u']).type.toString()).toBe(
        'list<number>'
      );
  });

  // A body that MAY hold a list must not be folded as a single term: `Sum(2u)`
  // answering `2u` is the same wrong answer `Sum(L)` used to give for a
  // valueless `L: list<number>`, and `u := [1, 2]` contradicts it.
  it('leaves a big op over a lone union inert until the value arrives', () => {
    const ce = engineWithU();
    expect(
      ce
        .box(['Sum', ['Multiply', 2, 'u']])
        .evaluate()
        .toString()
    ).toBe('sum(2u)');
    expect(ce.box(['Sum', 'u']).evaluate().toString()).toBe('sum(u)');
    expect(
      ce
        .box(['Product', ['Multiply', 2, 'u']])
        .evaluate()
        .toString()
    ).toBe('prod(2u)');
  });

  it('gives the scalar answers once the symbol holds a scalar', () => {
    const ce = engineWithU();
    ce.assign('u', 5);
    expect(ce.box(['Multiply', 2, 'u']).evaluate().toString()).toBe('10');
    expect(ce.box(['Add', 'u', 2]).evaluate().toString()).toBe('7');
    expect(ce.box(['Negate', 'u']).evaluate().toString()).toBe('-5');
    expect(ce.box(['Power', 'u', 2]).evaluate().toString()).toBe('25');
    expect(
      ce
        .box(['Sum', ['Multiply', 2, 'u']])
        .evaluate()
        .toString()
    ).toBe('10');
  });

  it('gives the broadcast answers once the symbol holds a list', () => {
    const ce = engineWithU();
    ce.assign('u', ce.box(['List', 1, 2]));
    expect(ce.box(['Multiply', 2, 'u']).evaluate().toString()).toBe('[2,4]');
    expect(ce.box(['Add', 'u', 2]).evaluate().toString()).toBe('[3,4]');
    expect(ce.box(['Negate', 'u']).evaluate().toString()).toBe('[-1,-2]');
    expect(ce.box(['Power', 'u', 2]).evaluate().toString()).toBe('[1,4]');
    expect(ce.box(['Sin', 'u']).evaluate().toString()).toBe('[sin(1),sin(2)]');
    expect(
      ce
        .box(['Sum', ['Multiply', 2, 'u']])
        .evaluate()
        .toString()
    ).toBe('6');
  });
});

describe('a big op over a body that MIGHT be a collection stays inert', () => {
  // `Sum(body)` with no index sums the body's elements when the body is a
  // collection and is the body itself when it is a scalar. A body whose type
  // only ADMITS a collection — `broadcastable<number>` from lifting over a
  // not-yet-defined function, or the application of an undeclared head —
  // cannot be folded either way until the value arrives: the fold
  // `Sum(2 + h(x)) → h(x) + 2` re-evaluated to `[5, 8]` once `h` returned a
  // list, where the sum is `13`.
  it('declines a broadcastable-typed body and an undeclared application', () => {
    const ce = new ComputeEngine();
    const lifted = ce.box(['Sum', ['Add', 2, ['h', 'x']]]);
    expect(lifted.ops![0].type.toString()).toBe('broadcastable<number>');
    expect(lifted.evaluate().operator).toBe('Sum');
    expect(ce.box(['Sum', ['h', 'x']]).evaluate().operator).toBe('Sum');
    ce.declare('b', 'broadcastable<number>');
    expect(ce.box(['Sum', 'b']).evaluate().operator).toBe('Sum');
    // Once the head is defined, the SAME stored form sums the list.
    ce.assign('h', ce.parse('x \\mapsto [x, 2x]'));
    ce.assign('x', 3);
    expect(ce.box(lifted.json).evaluate().toString()).toBe('13');
    expect(
      ce
        .box(['Sum', ['h', 'x']])
        .evaluate()
        .toString()
    ).toBe('9');
  });

  it('still folds a scalar body, including a bare undeclared symbol', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Sum', 5]).evaluate().toString()).toBe('5');
    expect(ce.box(['Sum', 'y']).evaluate().toString()).toBe('y');
    ce.declare('k', 'number');
    expect(
      ce
        .box(['Sum', ['Add', 'k', 1]])
        .evaluate()
        .toString()
    ).toBe('k + 1');
  });
});

/**
 * A union branch that a BROADCAST treats as atomic can still be ENUMERATED by
 * a big op, and a branch that never broadcasts can still be summed. The two
 * questions therefore have two predicates, and a big op must ask the
 * enumeration-side one:
 *
 * - a `tuple` branch and a `string` branch are atomic under broadcast — `2u`
 *   scales a tuple as one value and never lifts over a string — yet `Sum` of a
 *   tuple adds its components and `Sum` of a string walks its characters;
 * - a fixed-shape `vector<n>` branch and a non-indexed `set` branch are left to
 *   the tensor handlers / never broadcast, yet both sum;
 * - a `broadcastable<T>` branch may itself be an indexed collection at runtime.
 *
 * Folding such a body as a single scalar term answers `Sum(u)` → `u`, which the
 * identical expression contradicts as soon as the symbol holds the collection
 * branch. Pairs below: inert while the symbol is valueless, the enumerated
 * answer once it is assigned.
 */
describe('a big op over a union with a non-broadcast enumerable branch', () => {
  it('declines a tuple branch and sums the tuple once assigned', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | tuple<number, number>');
    expect(ce.box(['Sum', 'u']).evaluate().operator).toBe('Sum');
    // The BROADCAST reading of the same union is unchanged: a tuple operand is
    // atomic, scaled component-wise by the body's own arithmetic.
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'number | tuple<number, number>'
    );
    ce.assign('u', ce.box(['Tuple', 1, 2]));
    expect(ce.box(['Sum', 'u']).evaluate().toString()).toBe('3');
    expect(ce.box(['Multiply', 2, 'u']).evaluate().toString()).toBe('(2, 4)');
  });

  it('declines a string branch, which enumerates as characters', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number | string');
    expect(ce.box(['Sum', 't']).evaluate().operator).toBe('Sum');
    ce.assign('t', ce.string('abc'));
    // Summing characters is a type error — but it is the error the assigned
    // value earns, not the silent `t` the fold used to hand back.
    expect(ce.box(['Sum', 't']).evaluate().operator).toBe('Error');
  });

  it('declines a fixed-shape branch and a set branch', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'number | vector<2>');
    expect(ce.box(['Sum', 'v']).evaluate().operator).toBe('Sum');
    ce.assign('v', ce.box(['List', 1, 2]));
    expect(ce.box(['Sum', 'v']).evaluate().toString()).toBe('3');

    const setCe = new ComputeEngine();
    setCe.declare('q', 'number | set<number>');
    expect(setCe.box(['Sum', 'q']).evaluate().operator).toBe('Sum');
    setCe.assign('q', setCe.box(['Set', 1, 2]));
    expect(setCe.box(['Sum', 'q']).evaluate().toString()).toBe('3');
  });

  it('declines a broadcastable branch', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'number | broadcastable<number>');
    expect(ce.box(['Sum', 'b']).evaluate().operator).toBe('Sum');
    ce.assign('b', ce.box(['List', 1, 2]));
    expect(ce.box(['Sum', 'b']).evaluate().toString()).toBe('3');
  });
});

/**
 * The lone scalar-or-collection union carries through a LAMBDA application the
 * same way it does through `2u`: the argument may hold a scalar or a list, so
 * `f(u)` is not a collection and must not be typed the definite `list<E>` that
 * `u := 5` contradicts. Both lambda routes are pinned — a bare-assigned lambda
 * (an operator definition) and a declare-then-assign lambda (a value
 * definition with the declared signature).
 */
describe('a lambda applied to a LONE union-typed argument', () => {
  it('carries the union through a bare-assigned lambda', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<number>');
    ce.assign('f', ce.parse('x \\mapsto 2x'));
    expect(ce.box(['f', 'u']).type.toString()).toBe(
      'finite_number | list<finite_number>'
    );
    // The control: a DEFINITE collection argument still types a definite,
    // shape-aware list.
    expect(ce.box(['f', ['List', 1, 2]]).type.toString()).toBe(
      'vector<finite_number^2>'
    );
  });

  it('carries the union through a declared-signature lambda', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<number>');
    ce.declare('g', '(number) -> number');
    ce.assign('g', ce.parse('x \\mapsto 3x'));
    expect(ce.box(['g', 'u']).type.toString()).toBe('list<number> | number');
  });

  it('applies each branch once the argument holds a value', () => {
    const scalarCe = new ComputeEngine();
    scalarCe.declare('u', 'number | list<number>');
    scalarCe.assign('f', scalarCe.parse('x \\mapsto 2x'));
    scalarCe.assign('u', 5);
    expect(scalarCe.box(['f', 'u']).evaluate().toString()).toBe('10');

    const listCe = new ComputeEngine();
    listCe.declare('u', 'number | list<number>');
    listCe.assign('f', listCe.parse('x \\mapsto 2x'));
    listCe.assign('u', listCe.box(['List', 1, 2]));
    expect(listCe.box(['f', 'u']).evaluate().toString()).toBe('[2,4]');

    const declaredCe = new ComputeEngine();
    declaredCe.declare('u', 'number | list<number>');
    declaredCe.declare('g', '(number) -> number');
    declaredCe.assign('g', declaredCe.parse('x \\mapsto 3x'));
    declaredCe.assign('u', declaredCe.box(['List', 1, 2]));
    expect(declaredCe.box(['g', 'u']).evaluate().toString()).toBe('[3,6]');
  });
});
