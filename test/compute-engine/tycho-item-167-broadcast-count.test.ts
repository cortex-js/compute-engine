import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 167 (2026-08-11): `.count` was `undefined` on an un-evaluated
// arithmetic broadcast, even when the length was recoverable without
// evaluating — from the TYPE (`[1,2,3]+1` types `vector<finite_integer^3>`) or
// from the operand (`(1..99)+1`'s `Range` reports 99).
//
// The broadcasting arithmetic operators carry no collection handlers —
// broadcasting is a property of how they evaluate, not a collection operator —
// so `count` had nothing to delegate to. A caller wanting to prove finiteness
// BEFORE deciding whether to evaluate (a comprehension-domain guard) then had
// no way to do it short of the eager walk it was trying to avoid, and refused
// in 0 ms.
//
// `count` now reads the operands. That is exact because the length rule for a
// LIFTED operator is agreement, not zip-to-shortest
// (`docs/BROADCAST-MODEL.md`): a scalar operand is a lift and never
// participates, and participants of differing lengths are
// `incompatible-dimensions` rather than a shorter result.

describe('Tycho item 167: count of an un-evaluated broadcast', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  describe('the witness', () => {
    test('the failing comprehension domain reports its length', () => {
      expect(ce.parse('\\frac{2(1..99)}{99}-1').count).toBe(99);
    });

    test('and it agrees with the evaluated count', () => {
      const e = ce.parse('\\frac{2(1..99)}{99}-1');
      expect(e.count).toBe(e.evaluate().count);
    });
  });

  describe('every row of the filed table', () => {
    const rows: [string, number | undefined][] = [
      ['1..99', 99],
      ['(1..99)+1', 99],
      ['2(1..99)', 99],
      ['\\frac{2(1..99)}{99}-1', 99],
      ['\\left[1,2,3\\right]', 3],
      ['\\left[1,2,3\\right]+1', 3],
      ['\\mathrm{Map}(1..99, k \\mapsto 2k)', 99],
    ];
    for (const [latex, expected] of rows) {
      test(`${latex} -> ${expected}`, () => {
        expect(ce.parse(latex).count).toBe(expected);
      });
      test(`${latex} matches evaluate().count`, () => {
        const e = ce.parse(latex);
        expect(e.count).toBe(e.evaluate().count);
      });
    }
  });

  describe('it must not invent a count', () => {
    test('a scalar sum has none', () => {
      expect(ce.parse('1+2').count).toBeUndefined();
      expect(ce.parse('2\\cdot3').count).toBeUndefined();
    });

    test('a symbolic scalar has none', () => {
      expect(ce.parse('x+1').count).toBeUndefined();
    });

    test('MISMATCHED participants report undefined, not the shorter', () => {
      // Zip-to-shortest is explicitly not the model: a mismatch is an error,
      // so there is no length to report here.
      expect(
        ce.box(['Add', ['List', 1, 2, 3], ['List', 1, 2]]).count
      ).toBeUndefined();
    });

    test('agreeing participants report the common length', () => {
      expect(ce.box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]).count).toBe(3);
    });

    test('an unknown-length participant reports undefined', () => {
      expect(ce.parse('(1..)+1').count).toBeUndefined();
    });
  });

  describe('facets deliberately left alone', () => {
    test('isCollection stays false for a broadcast result', () => {
      // Consumers rely on this: `.isCollection` is deliberately false for a
      // `list<finite_number>`. Item 167 asked for the LENGTH, not for these
      // expressions to become collections.
      expect(ce.parse('\\left[1,2,3\\right]+1').isCollection).toBe(false);
    });

    test('a declared count handler still owns its own answer', () => {
      // `Map` has collection handlers; the broadcast fallback must not
      // second-guess them.
      expect(ce.parse('\\mathrm{Map}(1..99, k \\mapsto 2k)').count).toBe(99);
    });
  });
});
