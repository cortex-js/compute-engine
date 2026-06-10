/**
 * M0 baseline for the rule-dispatch track (docs/fungrim/FUNGRIM-PLAN-2-RULES.md §3 M0).
 *
 * This suite is the pre/post-index EQUIVALENCE ORACLE for the
 * operator-indexed rule dispatch work (Feature A): it snapshots the result of
 * `.simplify()` over an assumption-free corpus of ~150 expressions, and of
 * `.solve('x')` over ~20 representative equations.
 *
 * After the index lands (M2), this suite must pass with BYTE-IDENTICAL
 * snapshots — no `-u` re-recording allowed. If a snapshot changes, the index
 * changed observable behavior and the change must be investigated.
 *
 * Corpus design notes:
 * - All expressions are assumption-free (no `ce.assume()`), so the baseline
 *   is robust against the parallel REVIEW A3 work (`isLess`/`isGreater`
 *   returning `undefined`). If A3 lands mid-track and a snapshot drifts,
 *   re-record ONCE and note it.
 * - Snapshot names are the LaTeX inputs (stable ordering, descriptive).
 * - The corpus lives in `rule-dispatch-corpus.ts` so the benchmark and later
 *   milestones (M2 differential invariant test, M4) reuse the same inputs.
 */

import { engine } from '../utils';
import {
  SIMPLIFY_CORPUS,
  SIMPLIFY_CORPUS_FLAT,
  SOLVE_CORPUS,
} from './rule-dispatch-corpus';

describe('corpus integrity', () => {
  test('simplify corpus has no duplicate entries (stable snapshot names)', () => {
    const seen = new Set(SIMPLIFY_CORPUS_FLAT);
    expect(seen.size).toBe(SIMPLIFY_CORPUS_FLAT.length);
  });

  test('solve corpus has no duplicate entries (stable snapshot names)', () => {
    const seen = new Set(SOLVE_CORPUS);
    expect(seen.size).toBe(SOLVE_CORPUS.length);
  });

  test('corpus size is ~150 simplify + ~20 solve expressions', () => {
    expect(SIMPLIFY_CORPUS_FLAT.length).toBeGreaterThanOrEqual(140);
    expect(SOLVE_CORPUS.length).toBeGreaterThanOrEqual(20);
  });

  test('every corpus expression parses to a valid expression', () => {
    const invalid: string[] = [];
    for (const src of [...SIMPLIFY_CORPUS_FLAT, ...SOLVE_CORPUS]) {
      const expr = engine.parse(src);
      if (!expr.isValid) invalid.push(src);
    }
    expect(invalid).toEqual([]);
  });
});

for (const [family, exprs] of SIMPLIFY_CORPUS) {
  describe(`simplify: ${family}`, () => {
    for (const src of exprs) {
      test(src, () => {
        expect(engine.parse(src).simplify()).toMatchSnapshot();
      });
    }
  });
}

describe('solve for x', () => {
  for (const src of SOLVE_CORPUS) {
    test(src, () => {
      const roots = engine.parse(src).solve('x');
      // Serialize each root through the BoxedExpression snapshot serializer;
      // `null` (no solutions found) is snapshotted as-is.
      expect(roots ? [...roots] : null).toMatchSnapshot();
    });
  }
});
