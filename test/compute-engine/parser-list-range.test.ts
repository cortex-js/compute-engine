import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Parser: list range ellipsis', () => {
  describe('endpoint-only form [a ... b]', () => {
    test('`[1...9]` parses to Range(1, 9)', () => {
      expect(parse('\\left[1...9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\ldots 9]` (\\ldots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\ldots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\dots 9]` (\\dots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\dots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('symbolic endpoints', () => {
      expect(parse('\\left[a...b\\right]')).toEqual(['Range', 'a', 'b']);
    });
  });

  describe('inferred-step form [a, b, ..., c]', () => {
    test('`[1, 3, ..., 9]` → Range(1, 9, 2)', () => {
      expect(parse('\\left[1, 3, \\ldots, 9\\right]')).toEqual(['Range', 1, 9, 2]);
    });

    test('`[0, 0.1, ..., 1]` (float idiom) → Range(0, 1, 0.1)', () => {
      const result = parse('\\left[0, 0.1, \\ldots, 1\\right]');
      expect(result).toMatchObject(['Range', 0, 1, 0.1]);
    });

    test('`[0, 0.1, 0.2, ..., 1]` (with intermediate sample, tolerance-validated)', () => {
      // 0.1 + 0.1 ≠ 0.2 exactly, but within ce.tolerance.
      expect(parse('\\left[0, 0.1, 0.2, \\ldots, 1\\right]')).toMatchObject([
        'Range', 0, 1, 0.1,
      ]);
    });

    test('negative step `[10, 8, ..., 0]` → Range(10, 0, -2)', () => {
      expect(parse('\\left[10, 8, \\ldots, 0\\right]')).toEqual([
        'Range', 10, 0, -2,
      ]);
    });
  });

  describe('error cases', () => {
    test('inconsistent intermediate sample → parse error', () => {
      // step is 0.1 but third element is 0.5 (not 0.2)
      const result = ce.parse('\\left[0, 0.1, 0.5, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });

    test('degenerate step (b - a = 0) → parse error', () => {
      const result = ce.parse('\\left[1, 1, \\ldots, 5\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('custom ce.tolerance is respected', () => {
    test('loose tolerance (0.01) accepts slightly-off first gap', () => {
      // samples = [0, 0.1, 0.21]; step = last diff = 0.21 - 0.1 = 0.11
      // first gap: 0.1 - 0 - 0.11 = -0.01, abs = 0.01 ≤ tol (0.01) → accepted
      const ceLoose = new ComputeEngine();
      ceLoose.tolerance = 0.01;
      const result = ceLoose.parse(
        '\\left[0, 0.1, 0.21, \\ldots, 1\\right]'
      ).json;
      // step comes from the last two samples: 0.21 - 0.1
      expect(result).toMatchObject(['Range', 0, 1, expect.closeTo(0.11, 10)]);
    });

    test('tight tolerance (1e-12) rejects the same off step', () => {
      // same 0.01 discrepancy now exceeds tolerance → parse error
      const ceTight = new ComputeEngine();
      ceTight.tolerance = 1e-12;
      const result = ceTight.parse('\\left[0, 0.1, 0.21, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('outside list literal: \\ldots stays ContinuationPlaceholder', () => {
    test('bare \\ldots parses as ContinuationPlaceholder symbol', () => {
      // Outside a list-range context \ldots must remain a plain symbol, not
      // trigger any Range parsing.  Use json directly (no boxing) to avoid the
      // pre-existing "cannot change type of constant" throw in Add.
      const raw = ce.parse('\\ldots').json;
      expect(raw).toEqual('ContinuationPlaceholder');
    });
  });
});
